import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { CSSProperties, ReactNode } from "react";
import { startTransition, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { manifest } from "virtual:flypath/route-manifest";

import {
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  PREFETCH_HEADER,
  SCREEN_HEADER,
} from "../protocol/headers.ts";
import { FLIGHT_PARAM } from "../protocol/params.ts";
import { setRouter } from "../router/dispatch.ts";
import type { ManifestRoute } from "../router/manifest.ts";
import {
  containerById,
  declaredContainer,
  matchManifest,
  SHARED,
} from "../router/manifest.ts";
import type { Location, NavigationCommand } from "../router/navigation.ts";
import { parseCommand, parseLocation } from "../router/navigation.ts";
import { normalizePath } from "../router/path.ts";
import type { RevalidateMode } from "../router/revalidate.ts";
import type { ContainerRuntime } from "../router/scope.tsx";
import { ContainerRuntimeContext } from "../router/scope.tsx";
import type { Mode } from "../router/types.ts";
import type { RscPayload } from "./payload.ts";

type Branches = Readonly<Record<string, string>>;

type Snapshot = {
  url: string;
  payload: RscPayload;
  modal: { url: string; payload: RscPayload } | undefined;
  branches: Branches;
  epoch: number;
};

type State = Snapshot & { key: string };

export type Fetched = {
  payload?: RscPayload;
  command?: NavigationCommand;
  location?: Location;
};

const SNAPSHOT_LIMIT = 24;
const PAYLOAD_LIMIT = 24;

type ScrollPositions = readonly (readonly [number, number])[];

const snapshots = new Map<string, Snapshot>();
const scrolls = new Map<string, ScrollPositions>();
const prefetched = new Map<string, Promise<Fetched>>();

let epoch = 0;

function scrollers(): Element[] {
  const root = document.scrollingElement;
  return [
    ...(root === null ? [] : [root]),
    ...document.querySelectorAll("[data-fp-scroll]"),
  ];
}

function captureScroll(): ScrollPositions {
  return scrollers().map((node) => [node.scrollLeft, node.scrollTop] as const);
}

function restoreScroll(saved: ScrollPositions | undefined): void {
  scrollers().forEach((node, index) => {
    const [left, top] = saved?.[index] ?? [0, 0];
    node.scrollLeft = left;
    node.scrollTop = top;
  });
}

function cap<T>(store: Map<string, T>, limit: number): void {
  while (store.size > limit) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
}

function remember(key: string, snapshot: Snapshot): void {
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  cap(snapshots, SNAPSHOT_LIMIT);
  cap(scrolls, SNAPSHOT_LIMIT * 2);
}

let counter = 0;

function nextKey(): string {
  counter += 1;
  return `fp${counter}-${Date.now().toString(36)}`;
}

function historyKey(): string {
  const state = window.history.state as { __flypathKey?: string } | null;
  if (state?.__flypathKey) return state.__flypathKey;
  const key = nextKey();
  window.history.replaceState({ ...state, __flypathKey: key }, "");
  return key;
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function request(
  url: string,
  container: string | undefined,
  prefetch: boolean,
): Promise<Fetched> {
  const target = new URL(url, window.location.origin);
  target.searchParams.set(FLIGHT_PARAM, "1");

  const response = await fetch(target, {
    headers: {
      ...(container === undefined ? {} : { [SCREEN_HEADER]: container }),
      ...(prefetch ? { [PREFETCH_HEADER]: "1" } : {}),
    },
  });

  const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
  const location = parseLocation(response.headers.get(LOCATION_HEADER));

  if (response.status === 204 || !response.body) {
    void response.body?.cancel();
    return { command, location };
  }

  return {
    command,
    location,
    payload: await createFromFetch<RscPayload>(Promise.resolve(response)),
  };
}

function cacheKey(container: string | undefined, url: string): string {
  return `${container ?? "document"}:${url}`;
}

function seedPayload(location: Location, payload: RscPayload): void {
  const key = cacheKey(location.container, location.url);
  prefetched.set(key, Promise.resolve({ payload, location }));
  cap(prefetched, PAYLOAD_LIMIT);
}

function load(
  url: string,
  container: string | undefined,
  prefetch = false,
): Promise<Fetched> {
  const key = cacheKey(container, url);
  const cached = prefetched.get(key);
  if (cached) return cached;
  const task = request(url, container, prefetch);
  prefetched.set(key, task);
  cap(prefetched, PAYLOAD_LIMIT);
  task.catch(() => prefetched.delete(key));
  return task;
}

export function bump(mode: RevalidateMode): void {
  if (mode === "none") return;
  epoch += 1;
  prefetched.clear();
  if (mode === "reset") snapshots.clear();
}

function keep(state: State): Snapshot {
  return {
    url: state.url,
    payload: state.payload,
    modal: state.modal,
    branches: state.branches,
    epoch: state.epoch,
  };
}

function optionsFor(pathname: string): {
  presentation: string;
  prefetch: string | false;
  route: ManifestRoute | undefined;
} {
  const route = matchManifest(manifest, pathname);
  return {
    presentation: route?.options.presentation ?? "push",
    prefetch: route?.options.prefetch ?? false,
    route,
  };
}

function branchesFor(
  route: ManifestRoute | undefined,
  current: Branches,
): Branches {
  if (!route) return current;
  const next: Record<string, string> = { ...current };
  for (const [position, id] of route.placement.entries()) {
    if (containerById(manifest, id)?.kind !== "branches") continue;
    const child = route.placement[position + 1];
    if (child === undefined || child === SHARED) continue;
    next[id] = child;
  }
  return next;
}

function anchorFor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest("a");
}

function internalHref(anchor: HTMLAnchorElement): string | undefined {
  const href = anchor.getAttribute("href");
  if (href === null || href === "") return undefined;
  if (anchor.target !== "" && anchor.target !== "_self") return undefined;
  if (anchor.hasAttribute("download")) return undefined;
  if (anchor.getAttribute("rel")?.includes("external") === true) {
    return undefined;
  }
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return undefined;
  if (url.pathname === window.location.pathname && url.hash !== "") {
    return undefined;
  }
  return `${url.pathname}${url.search}`;
}

let dispatch: ((next: State) => void) | null = null;
let read: (() => State) | null = null;
let go: ((href: string, mode: Mode) => Promise<void>) | null = null;

export function swapPayload(payload: RscPayload): void {
  const state = read?.();
  if (!state) return;
  startTransition(() =>
    dispatch?.({ ...state, payload, modal: undefined, epoch }),
  );
}

export function applyCommand(command: NavigationCommand, seed?: Fetched): void {
  if (seed?.payload && seed.location) seedPayload(seed.location, seed.payload);
  if (command.kind === "back") {
    window.history.back();
    return;
  }
  if (!go) {
    window.location.href = command.to;
    return;
  }
  void go(command.to, command.mode);
}

export function refreshPayload(): void {
  const state = read?.();
  if (!state) return;
  const at = epoch;
  void load(state.url, undefined).then((result) => {
    if (result.command) {
      applyCommand(result.command, result);
      return;
    }
    if (!result.payload) return;
    startTransition(() =>
      dispatch?.({
        ...(read?.() ?? state),
        payload: result.payload as RscPayload,
        epoch: at,
      }),
    );
  });
}

function revalidatePayload(mode: RevalidateMode): void {
  if (mode === "none") return;
  bump(mode);
  refreshPayload();
}

const BACKDROP: CSSProperties = {
  alignItems: "flex-start",
  backgroundColor: "rgba(0, 0, 0, 0.45)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  overflow: "auto",
  padding: 24,
  position: "fixed",
  zIndex: 2147483000,
};

const SHEET: CSSProperties = {
  backgroundColor: "Canvas",
  borderRadius: 16,
  boxShadow: "0 24px 64px rgba(0, 0, 0, 0.35)",
  color: "CanvasText",
  maxWidth: 680,
  overflow: "hidden",
  width: "100%",
};

function Modal({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}): ReactNode {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
      style={BACKDROP}
    >
      <div style={SHEET}>{children}</div>
    </div>
  );
}

export function WebRouter({ initial }: { initial: RscPayload }): ReactNode {
  const [state, setState] = useState<State>(() => {
    const url = currentUrl();
    return {
      key: historyKey(),
      url,
      payload: initial,
      modal: undefined,
      branches: branchesFor(
        optionsFor(normalizePath(new URL(url, window.location.origin).pathname))
          .route,
        {},
      ),
      epoch,
    };
  });

  useEffect(() => {
    dispatch = (next) => setState(next);
    read = () => state;
    go = navigate;
    const detach = setRouter({
      go: (href, mode) => void navigate(href, mode),
      back: () => window.history.back(),
      revalidate: revalidatePayload,
    });
    return () => {
      dispatch = null;
      read = null;
      go = null;
      detach();
    };
  });

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    restoreScroll(scrolls.get(state.key));
  }, [state.key]);

  const navigate = useCallback(
    async (href: string, mode: Mode): Promise<void> => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) {
        window.location.href = href;
        return;
      }

      const path = `${url.pathname}${url.search}`;
      const { presentation, route } = optionsFor(normalizePath(url.pathname));
      const previous = read?.();
      const asModal = presentation === "modal" && previous !== undefined;

      const at = epoch;
      const result = await load(
        path,
        asModal && route ? declaredContainer(route.placement) : undefined,
      );
      if (result.command) {
        if (result.command.kind === "back") {
          window.history.back();
          return;
        }
        if (result.payload && result.location) {
          seedPayload(result.location, result.payload);
        }
        await navigate(result.command.to, result.command.mode);
        return;
      }
      const payload = result.payload;
      if (!payload) return;

      const committed = result.location?.url ?? path;
      const landed =
        committed === path
          ? route
          : optionsFor(
              normalizePath(
                new URL(committed, window.location.origin).pathname,
              ),
            ).route;

      const current = read?.();
      const positions = captureScroll();
      if (current) {
        scrolls.set(current.key, positions);
        remember(current.key, keep(current));
      }

      const key = nextKey();
      if (asModal) scrolls.set(key, positions);
      const branches = asModal
        ? (current?.branches ?? {})
        : branchesFor(landed, current?.branches ?? {});
      const next: State = asModal
        ? {
            key,
            url: current?.url ?? committed,
            payload: current?.payload ?? payload,
            modal: { url: committed, payload },
            branches,
            epoch: current?.epoch ?? at,
          }
        : {
            key,
            url: committed,
            payload,
            modal: undefined,
            branches,
            epoch: at,
          };

      if (mode === "push") {
        window.history.pushState({ __flypathKey: key }, "", committed);
      } else {
        window.history.replaceState({ __flypathKey: key }, "", committed);
      }

      startTransition(() => setState(next));
    },
    [],
  );

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = anchorFor(event.target);
      if (!anchor) return;
      const href = internalHref(anchor);
      if (href === undefined) return;
      event.preventDefault();
      void navigate(href, "push");
    };

    const onHover = (event: Event): void => {
      const anchor = anchorFor(event.target);
      if (!anchor) return;
      const href = internalHref(anchor);
      if (href === undefined) return;
      const path = normalizePath(new URL(href, window.location.href).pathname);
      if (optionsFor(path).prefetch !== "hover") return;
      void load(href, undefined, true);
    };

    const settle = (key: string, url: string, at: number): void => {
      void load(url, undefined).then((result) => {
        if (historyKey() !== key) return;
        if (result.command) {
          applyCommand(result.command, result);
          return;
        }
        if (!result.payload) return;
        const committed = result.location?.url ?? url;
        startTransition(() => {
          const current = read?.();
          if (current && current.key !== key) return;
          setState({
            key,
            url: committed,
            payload: result.payload as RscPayload,
            modal: undefined,
            branches: branchesFor(
              optionsFor(
                normalizePath(
                  new URL(committed, window.location.origin).pathname,
                ),
              ).route,
              current?.branches ?? {},
            ),
            epoch: at,
          });
        });
      });
    };

    const onPop = (): void => {
      const previous = read?.();
      if (previous) {
        scrolls.set(previous.key, captureScroll());
        remember(previous.key, keep(previous));
      }
      const key = historyKey();
      const url = currentUrl();
      const at = epoch;
      const snapshot = snapshots.get(key);
      if (snapshot) {
        startTransition(() => setState({ key, ...snapshot }));
        if (snapshot.epoch < at) settle(key, snapshot.url, at);
        return;
      }
      settle(key, url, at);
    };

    document.addEventListener("click", onClick);
    document.addEventListener("mouseover", onHover);
    document.addEventListener("touchstart", onHover, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseover", onHover);
      document.removeEventListener("touchstart", onHover);
      window.removeEventListener("popstate", onPop);
    };
  }, [navigate]);

  const runtime: ContainerRuntime = {
    activeBranch: (id) => state.branches[id],
  };

  return (
    <ContainerRuntimeContext.Provider value={runtime}>
      {state.payload.root}
      {state.modal
        ? createPortal(
            <Modal onDismiss={() => window.history.back()}>
              {state.modal.payload.root}
            </Modal>,
            document.body,
          )
        : null}
    </ContainerRuntimeContext.Provider>
  );
}
