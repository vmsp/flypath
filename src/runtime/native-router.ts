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
import type { Location, NavigationCommand } from "../router/navigation.ts";
import { normalizePath } from "../router/path.ts";
import type { RscPayload } from "./payload.ts";

export type Router = RouterTree;

export type Fetched = {
  payload?: RscPayload;
  command?: NavigationCommand;
  location?: Location;
};

export type Fetchers = {
  screen: (url: string, container: string) => Promise<Fetched>;
  fragment: (url: string, container: string) => Promise<RscPayload>;
  settle: (key: string, result: Fetched) => void;
};

const EMPTY: Router = { tree: {}, fragments: {} };

const SEED_LIMIT = 8;

const PENDING: Promise<RscPayload> = new Promise<RscPayload>(() => {});

const SEED_TTL = 5000;

type Seed = { payload: RscPayload; at: number };

const seeds = new Map<string, Seed>();

let counter = 0;

function nextKey(): string {
  counter += 1;
  return `entry-${counter}`;
}

function seedKey(container: string, url: string): string {
  const [path = "", query] = url.split("?");
  const search = query === undefined ? "" : `?${query}`;
  return `${container}:${normalizePath(path)}${search}`;
}

export function seedPayload(location: Location, payload: RscPayload): void {
  if (location.container === undefined) return;
  seeds.set(seedKey(location.container, location.url), {
    payload,
    at: Date.now(),
  });
  while (seeds.size > SEED_LIMIT) {
    const oldest = seeds.keys().next();
    if (oldest.done) break;
    seeds.delete(oldest.value);
  }
}

function takePayload(container: string, url: string): RscPayload | undefined {
  const key = seedKey(container, url);
  const hit = seeds.get(key);
  if (!hit) return undefined;
  seeds.delete(key);
  return Date.now() - hit.at > SEED_TTL ? undefined : hit.payload;
}

function rejected(message: string): Promise<RscPayload> {
  const promise = Promise.reject<RscPayload>(new Error(message));
  promise.catch(() => {});
  return promise;
}

function screenAt(
  key: string,
  url: string,
  container: string,
  fetchers: Fetchers,
): ScreenEntry {
  const matched = matchManifest(manifest, normalizePath(url));
  const seeded = takePayload(container, url);

  let payload: Promise<RscPayload>;
  if (seeded) {
    payload = Promise.resolve(seeded);
  } else {
    const pending = fetchers.screen(url, container);
    void pending.then(
      (result) => {
        fetchers.settle(key, result);
      },
      () => {},
    );
    payload = pending.then((result) => result.payload ?? PENDING);
  }

  return {
    kind: "screen",
    key,
    url,
    container,
    safeArea: matched?.options.safeArea,
    presentation: matched?.options.presentation ?? "push",
    payload,
  };
}

function makeScreen(
  url: string,
  container: string,
  fetchers: Fetchers,
): ScreenEntry {
  return screenAt(nextKey(), url, container, fetchers);
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

export function navigate(
  router: Router,
  url: string,
  replace: boolean,
  fetchers: Fetchers,
): Router {
  const placement = matchManifest(manifest, normalizePath(url))?.placement ?? [
    ROOT_CONTAINER,
  ];
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

function targetOf(router: Router, url: string): string {
  const placement = matchManifest(manifest, normalizePath(url))?.placement ?? [
    ROOT_CONTAINER,
  ];
  return resolveChain(router, placement).at(-1) ?? ROOT_CONTAINER;
}

export function relocate(
  router: Router,
  key: string,
  result: Fetched,
  fetchers: Fetchers,
): Router {
  const found = locate(router, key);
  if (!found) return router;

  const { command, location, payload } = result;

  if (!command) {
    if (
      !location ||
      normalizePath(location.url) === normalizePath(found.entry.url)
    ) {
      return router;
    }
    if (payload) seedPayload(location, payload);
    return withEntry(
      router,
      found.id,
      found.index,
      screenAt(key, location.url, found.entry.container, fetchers),
    );
  }

  if (command.kind === "back") {
    return withEntry(router, found.id, found.index, {
      ...found.entry,
      payload: rejected(
        'flypath: navigate("back") ran while rendering a screen; there is ' +
          "no history to pop until the screen exists",
      ),
    });
  }

  if (payload && location) seedPayload(location, payload);

  const target = targetOf(router, command.to);
  if (target === found.entry.container) {
    return withEntry(
      router,
      found.id,
      found.index,
      screenAt(key, command.to, target, fetchers),
    );
  }

  return navigate(
    withoutEntry(router, found.id, found.index),
    command.to,
    true,
    fetchers,
  );
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
                ? screenAt(entry.key, entry.url, entry.container, fetchers)
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
