import type { ReactNode } from "react";
import { manifest } from "virtual:flypath/route-manifest";

import type {
  Content,
  ContentMap,
  ScreenEntry,
} from "../components/native/navigator-context.ts";
import { chromeKey } from "../components/native/navigator-context.ts";
import { matchManifest } from "../router/manifest.ts";
import type { Location, NavigationCommand } from "../router/navigation.ts";
import { normalizePath } from "../router/path.ts";
import type { RevalidateMode } from "../router/revalidate.ts";
import type { Revalidation } from "../router/types.ts";
import type { Router } from "./native-router.ts";
import { focusedScreen, liveKeys, visible } from "./native-router.ts";
import type { RscPayload } from "./payload.ts";

export type Fetched = {
  payload?: RscPayload;
  command?: NavigationCommand;
  location?: Location;
};

export type Bridge = {
  screen: (
    url: string,
    container: string,
    chrome: readonly string[],
  ) => Promise<Fetched>;
  fragment: (url: string, container: string) => Promise<RscPayload>;
  router: () => Router;
  publish: (content: ContentMap) => void;
  settle: (key: string, result: Fetched) => void;
  dev: boolean;
};

export type Applied = {
  epoch: number;
  mode: RevalidateMode;
  key: string | undefined;
  url: string | undefined;
  payload: RscPayload | undefined;
};

const SEED_LIMIT = 8;

const CONTENT_LIMIT = 24;

const CHROME_PREFIX = "chrome:";

const PENDING: Promise<RscPayload> = new Promise<RscPayload>(() => {});

type Running = { id: number; url: string; epoch: number };

type Seed = { payload: RscPayload; epoch: number };

let bridge: Bridge | undefined;

let content: ContentMap = {};

let epoch = 0;

let forced = 0;

let requests = 0;

let scheduled = false;

const inflight = new Map<string, Running>();

const seeds = new Map<string, Seed>();

function isChrome(key: string): boolean {
  return key.startsWith(CHROME_PREFIX);
}

function log(message: string): void {
  if (!bridge?.dev) return;
  console.log(`flypath: ${message}`);
}

export function contentMap(): ContentMap {
  return content;
}

export function currentEpoch(): number {
  return epoch;
}

export function bumpEpoch(force: boolean): number {
  epoch += 1;
  if (force) forced = epoch;
  return epoch;
}

function optionsOf(url: string): {
  revalidate: Revalidation;
  staleTime: number;
} {
  const options = matchManifest(manifest, normalizePath(url))?.options;
  return {
    revalidate: options?.revalidate ?? "stale",
    staleTime: options?.staleTime ?? 0,
  };
}

export function staleTimeOf(url: string): number {
  return optionsOf(url).staleTime;
}

function publish(next: ContentMap): void {
  content = next;
  bridge?.publish(next);
}

function update(change: (map: ContentMap) => ContentMap): void {
  const next = change(content);
  if (next !== content) publish(next);
}

function ready(url: string, node: ReactNode, at: number): Content {
  return { status: "ready", url, epoch: at, at: Date.now(), node, busy: false };
}

function seedKey(container: string, url: string): string {
  const [path = "", query] = url.split("?");
  const search = query === undefined ? "" : `?${query}`;
  return `${container}:${normalizePath(path)}${search}`;
}

export function seedPayload(
  location: Location,
  payload: RscPayload,
  at: number,
): void {
  if (location.container === undefined) return;
  const key = seedKey(location.container, location.url);
  seeds.delete(key);
  seeds.set(key, { payload, epoch: at });
  while (seeds.size > SEED_LIMIT) {
    const oldest = seeds.keys().next();
    if (oldest.done) break;
    seeds.delete(oldest.value);
  }
}

function takeSeed(
  container: string,
  url: string,
  want: number,
): RscPayload | undefined {
  const key = seedKey(container, url);
  const hit = seeds.get(key);
  if (!hit) return undefined;
  seeds.delete(key);
  return hit.epoch < want ? undefined : hit.payload;
}

function withFragments(
  map: Record<string, Content>,
  fragments: Record<string, ReactNode> | undefined,
  at: number,
): void {
  if (!fragments) return;
  for (const [id, node] of Object.entries(fragments)) {
    const key = chromeKey(id);
    map[key] = ready("", node, at);
    inflight.delete(key);
  }
}

export function apply(input: Applied): void {
  if (input.mode === "none") return;
  if (input.mode === "stale" && !input.payload) return;

  update((map) => {
    const next: Record<string, Content> = {};
    for (const [key, value] of Object.entries(map)) {
      if (input.mode === "reset" && !isChrome(key)) continue;
      next[key] = value;
    }

    if (input.payload) {
      withFragments(next, input.payload.fragments, input.epoch);
      if (input.key !== undefined && input.url !== undefined) {
        next[input.key] = ready(input.url, input.payload.root, input.epoch);
        inflight.delete(input.key);
      }
    }

    return next;
  });
}

export function fail(key: string, error: unknown): void {
  inflight.delete(key);
  update((map) => {
    const current = map[key];
    return {
      ...map,
      [key]: {
        status: "error",
        url: current?.url ?? "",
        epoch,
        at: Date.now(),
        error,
      },
    };
  });
}

function resync(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const link = bridge;
    if (link) sync(link.router());
  });
}

function redirected(result: Fetched, url: string): boolean {
  if (result.command) return true;
  if (!result.location) return false;
  return normalizePath(result.location.url) !== normalizePath(url);
}

function land(
  key: string,
  url: string,
  at: number,
  chrome: readonly string[],
  result: Fetched,
): void {
  const away = redirected(result, url);

  if (away && result.payload && result.location) {
    seedPayload(result.location, result.payload, at);
  }

  for (const id of chrome) inflight.delete(chromeKey(id));

  update((map) => {
    const next = { ...map };
    if (result.payload) withFragments(next, result.payload.fragments, at);
    if (!away && result.payload) {
      next[key] = ready(url, result.payload.root, at);
    }
    return next;
  });

  bridge?.settle(key, result);
  resync();
}

function broke(
  key: string,
  url: string,
  at: number,
  chrome: readonly string[],
  error: unknown,
): void {
  for (const id of chrome) inflight.delete(chromeKey(id));
  update((map) => ({
    ...map,
    [key]: { status: "error", url, epoch: at, at: Date.now(), error },
  }));
  resync();
}

function startScreen(
  link: Bridge,
  entry: ScreenEntry,
  at: number,
  chrome: readonly string[],
  keep: boolean,
): void {
  const key = entry.key;
  requests += 1;
  const id = requests;
  const record: Running = { id, url: entry.url, epoch: at };
  inflight.set(key, record);
  for (const chromeId of chrome) inflight.set(chromeKey(chromeId), record);

  log(
    `fetching ${entry.url} for ${key} at epoch ${String(at)}` +
      (chrome.length === 0 ? "" : ` with chrome ${chrome.join(", ")}`),
  );

  const task = link.screen(entry.url, entry.container, chrome);
  const promise = task.then((result) => result.payload ?? PENDING);
  promise.catch(() => {});

  update((map) => {
    const current = map[key];
    if (keep && current?.status === "ready") {
      return { ...map, [key]: { ...current, busy: true } };
    }
    return {
      ...map,
      [key]: {
        status: "loading",
        url: entry.url,
        epoch: at,
        at: Date.now(),
        promise,
      },
    };
  });

  void task.then(
    (result) => {
      if (inflight.get(key)?.id !== id) return;
      inflight.delete(key);
      land(key, entry.url, at, chrome, result);
    },
    (error: unknown) => {
      if (inflight.get(key)?.id !== id) return;
      inflight.delete(key);
      broke(key, entry.url, at, chrome, error);
    },
  );
}

function startChrome(link: Bridge, id: string, url: string, at: number): void {
  const key = chromeKey(id);
  requests += 1;
  const request = requests;
  inflight.set(key, { id: request, url, epoch: at });

  log(`fetching chrome ${id} around ${url} at epoch ${String(at)}`);

  const task = link.fragment(url, id);
  task.catch(() => {});

  update((map) => {
    const current = map[key];
    if (current?.status === "ready") {
      return { ...map, [key]: { ...current, busy: true } };
    }
    return {
      ...map,
      [key]: {
        status: "loading",
        url,
        epoch: at,
        at: Date.now(),
        promise: task,
      },
    };
  });

  void task.then(
    (payload) => {
      if (inflight.get(key)?.id !== request) return;
      inflight.delete(key);
      update((map) => ({ ...map, [key]: ready("", payload.root, at) }));
    },
    (error: unknown) => {
      if (inflight.get(key)?.id !== request) return;
      inflight.delete(key);
      update((map) => ({
        ...map,
        [key]: { status: "error", url, epoch: at, at: Date.now(), error },
      }));
    },
  );
}

function stale(current: Content | undefined, want: number): boolean {
  if (!current) return true;
  return current.epoch < want;
}

function running(key: string, url: string, want: number): boolean {
  const current = inflight.get(key);
  return current !== undefined && current.url === url && current.epoch >= want;
}

type Need = "fresh" | "keep" | "drop";

function needScreen(entry: ScreenEntry, at: number): Need {
  const current = content[entry.key];
  const matches = current !== undefined && current.url === entry.url;
  const mode = optionsOf(entry.url).revalidate;
  const want = mode === "never" ? forced : at;

  if (matches && !stale(current, want)) return "fresh";

  if (!matches) {
    const seeded = takeSeed(entry.container, entry.url, at);
    if (seeded) {
      log(`seeded ${entry.url} for ${entry.key} at epoch ${String(at)}`);
      update((map) => {
        const next = { ...map, [entry.key]: ready(entry.url, seeded.root, at) };
        withFragments(next, seeded.fragments, at);
        return next;
      });
      return "fresh";
    }
  }

  if (running(entry.key, entry.url, want)) return "fresh";

  return matches && mode === "stale" && current.status === "ready"
    ? "keep"
    : "drop";
}

function needChrome(id: string, url: string, at: number): boolean {
  const key = chromeKey(id);
  if (!stale(content[key], at)) return false;
  return !running(key, url, at);
}

function evict(router: Router): void {
  const live = liveKeys(router);
  const seen = new Set(visible(router).screens.map((entry) => entry.key));

  const kept: [string, Content][] = [];
  const next: Record<string, Content> = {};

  for (const [key, value] of Object.entries(content)) {
    if (isChrome(key)) {
      next[key] = value;
      continue;
    }
    if (!live.has(key)) continue;
    kept.push([key, value]);
  }

  kept.sort((a, b) => b[1].at - a[1].at);

  let budget = CONTENT_LIMIT;
  for (const [key, value] of kept) {
    if (!seen.has(key)) {
      if (budget <= 0) continue;
      budget -= 1;
    }
    next[key] = value;
  }

  if (Object.keys(next).length === Object.keys(content).length) return;
  for (const key of Object.keys(content)) {
    if (next[key] === undefined) inflight.delete(key);
  }
  publish(next);
}

export function sync(router: Router): void {
  const link = bridge;
  if (!link) return;

  evict(router);

  const at = epoch;
  const seen = visible(router);
  const focused = focusedScreen(router);
  const url = focused?.url ?? "/";

  const chrome = seen.chrome.filter((id) => needChrome(id, url, at));

  const jobs: { entry: ScreenEntry; keep: boolean }[] = [];
  for (const entry of seen.screens) {
    const need = needScreen(entry, at);
    if (need === "fresh") continue;
    jobs.push({ entry, keep: need === "keep" });
  }

  const carrier = jobs.find((job) => job.entry.key === focused?.key);

  for (const job of jobs) {
    startScreen(link, job.entry, at, job === carrier ? chrome : [], job.keep);
  }

  if (carrier) return;
  for (const id of chrome) startChrome(link, id, url, at);
}

export function attach(next: Bridge): () => void {
  bridge = next;
  next.publish(content);
  return () => {
    if (bridge === next) bridge = undefined;
  };
}
