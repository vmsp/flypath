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
import type { Fetched } from "./native-content.ts";

export type Router = RouterTree;

export type Visible = {
  screens: readonly ScreenEntry[];
  chrome: readonly string[];
};

const EMPTY: Router = { tree: {}, epoch: 0 };

let counter = 0;

function nextKey(): string {
  counter += 1;
  return `entry-${counter}`;
}

function screenAt(key: string, url: string, container: string): ScreenEntry {
  const matched = matchManifest(manifest, normalizePath(url));

  return {
    kind: "screen",
    key,
    url,
    container,
    safeArea: matched?.options.safeArea,
    presentation: matched?.options.presentation ?? "push",
    transition: matched?.options.transition ?? "platform",
    gesture: matched?.options.gesture ?? true,
  };
}

function makeScreen(url: string, container: string): ScreenEntry {
  return screenAt(nextKey(), url, container);
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

function ensure(router: Router, id: string): Router {
  if (router.tree[id]) return router;

  const info = containerById(manifest, id);
  if (!info) return router;

  const child = info.branches[0];

  if (info.kind === "branches") {
    if (child === undefined) return router;
    return ensure(setActive(router, id, child), child);
  }

  const next = setStack(router, id, [
    child === undefined ? makeScreen(info.root, id) : makeContainer(child),
  ]);
  return child === undefined ? next : ensure(next, child);
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

function focusChain(router: Router): readonly string[] {
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

export function visible(router: Router): Visible {
  const screens: ScreenEntry[] = [];
  const chrome: string[] = [];

  const walkStack = (id: string): void => {
    const state = router.tree[id];
    if (state?.kind !== "stack") return;
    for (let at = state.entries.length - 1; at >= 0; at -= 1) {
      const entry = state.entries[at];
      if (entry === undefined) return;
      if (entry.kind === "container") {
        walkContainer(entry.id);
        return;
      }
      screens.push(entry);
      if (entry.presentation !== "modal") return;
    }
  };

  const walkContainer = (id: string): void => {
    const info = containerById(manifest, id);
    if (!info) return;
    if (info.chrome) chrome.push(id);
    if (info.kind !== "branches") {
      walkStack(id);
      return;
    }
    const active = activeBranch(router, id);
    if (active !== undefined && router.tree[active]) walkContainer(active);
  };

  walkContainer(ROOT_CONTAINER);
  return { screens, chrome };
}

export function liveKeys(router: Router): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const state of Object.values(router.tree)) {
    if (state.kind !== "stack") continue;
    for (const entry of state.entries) {
      if (entry.kind === "screen") keys.add(entry.key);
    }
  }
  return keys;
}

export function navigate(
  router: Router,
  url: string,
  replace: boolean,
): Router {
  const placement = matchManifest(manifest, normalizePath(url))?.placement ?? [
    ROOT_CONTAINER,
  ];
  const chain = resolveChain(router, placement);
  const focused = focusChain(router).at(-1);

  let next = router;

  for (const [position, id] of chain.entries()) {
    next = ensure(next, id);
    const child = chain[position + 1];
    if (child === undefined) break;
    next = ensure(next, child);

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

  return setStack(next, target, [...kept, makeScreen(url, target)]);
}

export function initialRouter(url: string): Router {
  return navigate(EMPTY, url, false);
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

type Located = { id: string; index: number; entry: ScreenEntry };

function locate(router: Router, key: string): Located | undefined {
  for (const [id, state] of Object.entries(router.tree)) {
    if (state.kind !== "stack") continue;
    const index = state.entries.findIndex((entry) => entry.key === key);
    const entry = index === -1 ? undefined : state.entries[index];
    if (entry?.kind === "screen") return { id, index, entry };
  }
  return undefined;
}

export function entryOf(
  router: Router,
  key: string | undefined,
): ScreenEntry | undefined {
  return key === undefined ? undefined : locate(router, key)?.entry;
}

function withEntry(
  router: Router,
  id: string,
  index: number,
  entry: Entry,
): Router {
  const state = router.tree[id];
  if (state?.kind !== "stack") return router;
  const entries = state.entries.map((current, at) =>
    at === index ? entry : current,
  );
  return setStack(router, id, entries);
}

function withoutEntry(router: Router, id: string, index: number): Router {
  const state = router.tree[id];
  if (state?.kind !== "stack") return router;
  const entries = state.entries.filter((_, at) => at !== index);
  if (entries.length > 0) return setStack(router, id, entries);

  const tree = { ...router.tree };
  delete tree[id];

  const parent = containerById(manifest, id)?.parent;
  const above = parent === undefined ? undefined : tree[parent];
  const first =
    parent === undefined
      ? undefined
      : containerById(manifest, parent)?.branches[0];

  if (
    parent !== undefined &&
    above?.kind === "branches" &&
    above.active === id &&
    first !== undefined &&
    first !== id
  ) {
    tree[parent] = { kind: "branches", active: first };
  }

  return { ...router, tree };
}

export function popKeys(router: Router, keys: readonly string[]): Router {
  let next = router;
  for (const key of keys) {
    const found = locate(next, key);
    if (!found) continue;
    next = withoutEntry(next, found.id, found.index);
  }
  return next;
}

function targetOf(router: Router, url: string): string {
  const placement = matchManifest(manifest, normalizePath(url))?.placement ?? [
    ROOT_CONTAINER,
  ];
  return resolveChain(router, placement).at(-1) ?? ROOT_CONTAINER;
}

export function relocate(router: Router, key: string, result: Fetched): Router {
  const found = locate(router, key);
  if (!found) return router;

  const { command, location } = result;

  if (!command) {
    if (
      !location ||
      normalizePath(location.url) === normalizePath(found.entry.url)
    ) {
      return router;
    }
    return withEntry(
      router,
      found.id,
      found.index,
      screenAt(key, location.url, found.entry.container),
    );
  }

  if (command.kind === "back") return router;

  const target = targetOf(router, command.to);
  if (target === found.entry.container) {
    return withEntry(
      router,
      found.id,
      found.index,
      screenAt(key, command.to, target),
    );
  }

  return navigate(
    withoutEntry(router, found.id, found.index),
    command.to,
    true,
  );
}
