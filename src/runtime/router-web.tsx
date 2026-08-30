import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { CSSProperties, ReactNode } from "react";
import { startTransition, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { manifest } from "virtual:flypath/route-manifest";

import { NavigationContext, registerBack } from "../router/client.ts";
import type { ManifestRoute } from "../router/manifest.ts";
import {
  containerById,
  declaredContainer,
  matchManifest,
  SHARED,
} from "../router/manifest.ts";
import { normalizePath, searchParamsOf } from "../router/path.ts";
import type { ContainerRuntime } from "../router/scope.tsx";
import { ContainerRuntimeContext } from "../router/scope.tsx";
import type { Navigation, Params } from "../router/types.ts";
import type { RscPayload } from "./payload.ts";

type Branches = Readonly<Record<string, string>>;

type Snapshot = {
  url: string;
  payload: RscPayload;
  modal: { url: string; payload: RscPayload } | undefined;
  branches: Branches;
};

type State = Snapshot & { key: string };

type Fetched = { payload?: RscPayload; redirect?: string };

const SNAPSHOT_LIMIT = 24;
const PAYLOAD_LIMIT = 24;

type ScrollPositions = readonly (readonly [number, number])[];

const snapshots = new Map<string, Snapshot>();
const scrolls = new Map<string, ScrollPositions>();
const prefetched = new Map<string, Promise<Fetched>>();

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
): Promise<Fetched> {
  const target = new URL(url, window.location.origin);
  target.searchParams.set("__flight", "1");

  const response = await fetch(target, {
    headers: container === undefined ? {} : { "x-flypath-screen": container },
  });

  const redirect = response.headers.get("x-flypath-redirect");
  if (redirect !== null) {
    void response.body?.cancel();
    return { redirect };
  }

  return {
    payload: await createFromFetch<RscPayload>(Promise.resolve(response)),
  };
}

function load(url: string, container: string | undefined): Promise<Fetched> {
  const cacheKey = `${container ?? "document"}:${url}`;
  const cached = prefetched.get(cacheKey);
  if (cached) return cached;
  const task = request(url, container);
  prefetched.set(cacheKey, task);
  cap(prefetched, PAYLOAD_LIMIT);
  task.catch(() => prefetched.delete(cacheKey));
  return task;
}

function invalidatePayloads(): void {
  prefetched.clear();
  snapshots.clear();
}

function optionsFor(pathname: string): {
  params: Params;
  presentation: string;
  prefetch: string | false;
  route: ManifestRoute | undefined;
} {
  const matched = matchManifest(manifest, pathname);
  return {
    params: matched?.params ?? {},
    presentation: matched?.route.options.presentation ?? "push",
    prefetch: matched?.route.options.prefetch ?? false,
    route: matched?.route,
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
let go: ((href: string, mode: "push" | "replace") => Promise<void>) | null =
  null;

export function swapPayload(payload: RscPayload): void {
  const state = read?.();
  if (!state) return;
  invalidatePayloads();
  startTransition(() => dispatch?.({ ...state, payload, modal: undefined }));
}

export function followRedirect(href: string): void {
  invalidatePayloads();
  if (!go) {
    window.location.href = href;
    return;
  }
  void go(href, "replace");
}

export function refreshPayload(): void {
  const state = read?.();
  if (!state) return;
  invalidatePayloads();
  void load(state.url, undefined).then((result) => {
    if (!result.payload) return;
    startTransition(() =>
      dispatch?.({
        ...(read?.() ?? state),
        payload: result.payload as RscPayload,
      }),
    );
  });
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
    };
  });

  useEffect(() => {
    dispatch = (next) => setState(next);
    read = () => state;
    go = navigate;
    registerBack(() => window.history.back());
    return () => {
      dispatch = null;
      read = null;
      go = null;
      registerBack(undefined);
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
    async (href: string, mode: "push" | "replace"): Promise<void> => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) {
        window.location.href = href;
        return;
      }

      const path = `${url.pathname}${url.search}`;
      const { presentation, route } = optionsFor(normalizePath(url.pathname));
      const previous = read?.();
      const asModal = presentation === "modal" && previous !== undefined;

      const result = await load(
        path,
        asModal && route ? declaredContainer(route.placement) : undefined,
      );
      if (result.redirect !== undefined) {
        await navigate(result.redirect, "replace");
        return;
      }
      const payload = result.payload;
      if (!payload) return;

      const current = read?.();
      const positions = captureScroll();
      if (current) {
        scrolls.set(current.key, positions);
        remember(current.key, {
          url: current.url,
          payload: current.payload,
          modal: current.modal,
          branches: current.branches,
        });
      }

      const key = nextKey();
      if (asModal) scrolls.set(key, positions);
      const branches = asModal
        ? (current?.branches ?? {})
        : branchesFor(route, current?.branches ?? {});
      const next: State = asModal
        ? {
            key,
            url: current?.url ?? path,
            payload: current?.payload ?? payload,
            modal: { url: path, payload },
            branches,
          }
        : { key, url: path, payload, modal: undefined, branches };

      if (mode === "push") {
        window.history.pushState({ __flypathKey: key }, "", path);
      } else {
        window.history.replaceState({ __flypathKey: key }, "", path);
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
      void load(href, undefined);
    };

    const onPop = (): void => {
      const previous = read?.();
      if (previous) {
        scrolls.set(previous.key, captureScroll());
        remember(previous.key, {
          url: previous.url,
          payload: previous.payload,
          modal: previous.modal,
          branches: previous.branches,
        });
      }
      const key = historyKey();
      const url = currentUrl();
      const snapshot = snapshots.get(key);
      if (snapshot) {
        startTransition(() => setState({ key, ...snapshot }));
        return;
      }
      void load(url, undefined).then((result) => {
        if (!result.payload) return;
        startTransition(() => {
          const current = read?.();
          setState({
            key,
            url,
            payload: result.payload as RscPayload,
            modal: undefined,
            branches: branchesFor(
              optionsFor(
                normalizePath(new URL(url, window.location.origin).pathname),
              ).route,
              current?.branches ?? {},
            ),
          });
        });
      });
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

  const current = new URL(
    state.modal?.url ?? state.url,
    window.location.origin,
  );
  const pathname = normalizePath(current.pathname);

  const value: Navigation = {
    pathname,
    params: optionsFor(pathname).params,
    searchParams: searchParamsOf(current),
  };

  const runtime: ContainerRuntime = {
    activeBranch: (id) => state.branches[id],
  };

  return (
    <ContainerRuntimeContext.Provider value={runtime}>
      <NavigationContext.Provider value={value}>
        {state.payload.root}
        {state.modal
          ? createPortal(
              <Modal onDismiss={() => window.history.back()}>
                {state.modal.payload.root}
              </Modal>,
              document.body,
            )
          : null}
      </NavigationContext.Provider>
    </ContainerRuntimeContext.Provider>
  );
}
