import { manifest } from "virtual:flypath/route-manifest";

import type {
  ContainerState,
  Entry,
  RouterTree,
  ScreenEntry,
} from "../components/native/navigator-context.ts";
import {
  containerById,
  matchManifest,
  ROOT_CONTAINER,
  SHARED,
} from "../router/manifest.ts";
import { normalizePath } from "../router/path.ts";
import type { RscPayload } from "./payload.ts";

export type Router = RouterTree;

export type Fetchers = {
  screen: (url: string, container: string) => Promise<RscPayload>;
  fragment: (url: string, container: string) => Promise<RscPayload>;
};

const EMPTY: Router = { tree: {}, fragments: {} };

let counter = 0;

function nextKey(): string {
  counter += 1;
  return `entry-${counter}`;
}

function makeScreen(
  url: string,
  container: string,
  fetchers: Fetchers,
): ScreenEntry {
  const matched = matchManifest(manifest, normalizePath(url));
  return {
    kind: "screen",
    key: nextKey(),
    url,
    container,
    safeArea: matched?.route.options.safeArea,
    presentation: matched?.route.options.presentation ?? "push",
    payload: fetchers.screen(url, container),
  };
}

function makeContainer(id: string): Entry {
  return { kind: "container", key: nextKey(), id };
}

function setStack(
  router: Router,
  id: string,
  entries: readonly Entry[],
): Router {
  return {
    ...router,
    tree: { ...router.tree, [id]: { kind: "stack", entries } },
  };
}

function setActive(router: Router, id: string, active: string): Router {
  return {
    ...router,
    tree: { ...router.tree, [id]: { kind: "branches", active } },
  };
}

function ensure(
  router: Router,
  id: string,
  url: string,
  fetchers: Fetchers,
): Router {
  if (router.tree[id]) return router;

  const info = containerById(manifest, id);
  if (!info) return router;

  let next =
    info.chrome && !router.fragments[id]
      ? {
          ...router,
          fragments: { ...router.fragments, [id]: fetchers.fragment(url, id) },
        }
      : router;

  const child = info.branches[0];

  if (info.kind === "branches") {
    if (child === undefined) return next;
    next = setActive(next, id, child);
    return ensure(next, child, url, fetchers);
  }

  next = setStack(next, id, [
    child === undefined
      ? makeScreen(info.root, id, fetchers)
      : makeContainer(child),
  ]);
  return child === undefined ? next : ensure(next, child, url, fetchers);
}

export function activeBranch(router: Router, id: string): string | undefined {
  const state = router.tree[id];
  if (state?.kind === "branches") return state.active;
  return containerById(manifest, id)?.branches[0];
}

function resolveChain(
  router: Router,
  placement: readonly string[],
): readonly string[] {
  const chain: string[] = [];

  for (const id of placement) {
    if (id !== SHARED) {
      chain.push(id);
      continue;
    }
    const branch = activeBranch(router, chain.at(-1) ?? ROOT_CONTAINER);
    if (branch !== undefined) chain.push(branch);
  }

  for (;;) {
    const last = chain.at(-1);
    if (last === undefined) break;
    if (containerById(manifest, last)?.kind !== "branches") break;
    const branch = activeBranch(router, last);
    if (branch === undefined) break;
    chain.push(branch);
  }

  return chain.length === 0 ? [ROOT_CONTAINER] : chain;
}

export function focusChain(router: Router): readonly string[] {
  const chain: string[] = [];
  let id: string | undefined = ROOT_CONTAINER;

  while (id !== undefined) {
    chain.push(id);
    const state: ContainerState | undefined = router.tree[id];
    if (!state) break;
    if (state.kind === "branches") {
      id = state.active;
      continue;
    }
    const top = state.entries.at(-1);
    id = top?.kind === "container" ? top.id : undefined;
  }

  return chain;
}

export function focusedScreen(router: Router): ScreenEntry | undefined {
  const id = focusChain(router).at(-1);
  const state = id === undefined ? undefined : router.tree[id];
  if (state?.kind !== "stack") return undefined;
  const top = state.entries.at(-1);
  return top?.kind === "screen" ? top : undefined;
}

export function navigate(
  router: Router,
  url: string,
  replace: boolean,
  fetchers: Fetchers,
): Router {
  const matched = matchManifest(manifest, normalizePath(url));
  const placement = matched?.route.placement ?? [ROOT_CONTAINER];
  const chain = resolveChain(router, placement);
  const focused = focusChain(router).at(-1);

  let next = router;

  for (const [position, id] of chain.entries()) {
    next = ensure(next, id, url, fetchers);
    const child = chain[position + 1];
    if (child === undefined) break;
    next = ensure(next, child, url, fetchers);

    const state = next.tree[id];
    if (!state) continue;
    if (state.kind === "branches") {
      if (state.active !== child) next = setActive(next, id, child);
      continue;
    }

    const at = state.entries.findIndex(
      (entry) => entry.kind === "container" && entry.id === child,
    );
    if (at === -1) {
      next = setStack(next, id, [makeContainer(child)]);
    } else if (at < state.entries.length - 1) {
      next = setStack(next, id, state.entries.slice(0, at + 1));
    }
  }

  const target = chain.at(-1) ?? ROOT_CONTAINER;
  const info = containerById(manifest, target);
  const state = next.tree[target];
  if (!info || state?.kind !== "stack") return next;

  if (!replace && normalizePath(url) === normalizePath(info.root)) {
    return focused === target && state.entries.length > 1
      ? setStack(next, target, state.entries.slice(0, 1))
      : next;
  }

  const top = state.entries.at(-1);
  const kept =
    replace && top?.kind === "screen"
      ? state.entries.slice(0, -1)
      : state.entries;

  return setStack(next, target, [...kept, makeScreen(url, target, fetchers)]);
}

export function initialRouter(url: string, fetchers: Fetchers): Router {
  return navigate(EMPTY, url, false, fetchers);
}

export function goBack(router: Router): Router | undefined {
  const chain = focusChain(router);

  for (const id of [...chain].reverse()) {
    const state = router.tree[id];
    if (!state) continue;

    if (state.kind === "stack") {
      if (state.entries.length > 1) {
        return setStack(router, id, state.entries.slice(0, -1));
      }
      continue;
    }

    const first = containerById(manifest, id)?.branches[0];
    if (first !== undefined && state.active !== first) {
      return setActive(router, id, first);
    }
  }

  return undefined;
}

export function applyPayload(
  router: Router,
  payload: Promise<RscPayload>,
): Router {
  const id = focusChain(router).at(-1);
  const state = id === undefined ? undefined : router.tree[id];
  if (id === undefined || state?.kind !== "stack") return router;
  const top = state.entries.at(-1);
  if (top?.kind !== "screen") return router;
  return setStack(router, id, [
    ...state.entries.slice(0, -1),
    { ...top, payload },
  ]);
}

export function refresh(router: Router, fetchers: Fetchers): Router {
  const url = focusedScreen(router)?.url ?? "/";
  const tree: Record<string, ContainerState> = {};

  for (const [id, state] of Object.entries(router.tree)) {
    tree[id] =
      state.kind === "stack"
        ? {
            kind: "stack",
            entries: state.entries.map((entry) =>
              entry.kind === "screen"
                ? {
                    ...entry,
                    payload: fetchers.screen(entry.url, entry.container),
                  }
                : entry,
            ),
          }
        : state;
  }

  const fragments: Record<string, Promise<RscPayload>> = {};
  for (const id of Object.keys(router.fragments)) {
    fragments[id] = fetchers.fragment(url, id);
  }

  return { tree, fragments };
}
