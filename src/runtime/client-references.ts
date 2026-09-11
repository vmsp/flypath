import { setRequireModule } from "@vitejs/plugin-rsc/core/browser";
import { registry } from "virtual:flypath/client-references";
import { nativeReferences } from "virtual:flypath/native-references";

import { BASE_HEADER, BINARY_HEADER } from "../shared/headers.ts";
import { nativeConfig } from "./native-config.ts";

function stripReferenceTag(id: string): string {
  let value = id.split("$$")[0] ?? id;
  const query = value.indexOf("?");
  if (query !== -1) value = value.slice(0, query);
  return value;
}

function normalizeReferenceId(id: string): string {
  const value = stripReferenceTag(id);
  return value.startsWith("/@fs") ? value.slice("/@fs".length) : value;
}

function assertLocal(reference: string): void {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
    throw new Error(
      `Refusing to load client reference "${reference}" — ` +
        "chunks may only be fetched from the configured flypath server",
    );
  }
}

function evaluateChunk(code: string, url: string): void {
  const evaluate = globalThis.globalEvalWithSourceUrl;
  if (evaluate) evaluate(code, url);
  else (0, eval)(`${code}\n//# sourceURL=${url}\n`);
}

function installBundleLoader(): void {
  if (globalThis.__loadBundleAsync) return;
  globalThis.__loadBundleAsync = async (bundlePath: string) => {
    const url = `${nativeConfig().serverUrl}${bundlePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(
        `Chunk request failed (${response.status}) for ${url}` +
          (reason === "" ? "" : `\n${reason}`),
      );
    }
    evaluateChunk(await response.text(), url);
  };
}

const downloads = new Map<string, Promise<void>>();

function chunkPath(file: string): string {
  const { platform } = nativeConfig();
  return `/chunk/${platform}/${file}`;
}

function download(path: string): Promise<void> {
  const existing = downloads.get(path);
  if (existing) return existing;

  const load = globalThis.__loadBundleAsync;
  if (!load) {
    return Promise.reject(new Error("Native chunk loader is not installed"));
  }

  const task = load(path).catch((error: unknown) => {
    downloads.delete(path);
    throw error;
  });
  downloads.set(path, task);
  return task;
}

type ChunkManifest = {
  baseId: string;
  build: string;
  chunks: Record<string, string>;
};

export class UpdateRequired extends Error {}

let pending: Promise<ChunkManifest> | undefined;

let known: string | undefined;

let reported = false;

let stale = false;

export function noteBuild(build: string | null): void {
  if (build === null || build === "" || build === known) return;
  if (known !== undefined) pending = undefined;
  known = build;
}

export function updateRequired(): boolean {
  return stale;
}

function skewMessage(server: string, binary: string): string {
  return (
    "This build of the app was made against a different base bundle " +
    `than the running server (app ${binary}, server ${server}) — screens it ` +
    "already carries keep working; anything new needs a rebuilt app"
  );
}

function reportSkew(server: string): void {
  if (reported) return;
  reported = true;
  const { serverUrl, platform, baseId, build } = nativeConfig();
  console.warn(skewMessage(server, baseId));
  void fetch(`${serverUrl}/flypath-skew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform,
      kind: "base",
      binary: baseId,
      server,
      build,
    }),
  }).catch(() => undefined);
}

async function fetchManifest(): Promise<ChunkManifest> {
  const { serverUrl, platform, baseId, build } = nativeConfig();
  const response = await fetch(`${serverUrl}/native/${platform}.json`, {
    headers: { [BASE_HEADER]: baseId, [BINARY_HEADER]: build },
  });

  if (response.status === 426) {
    stale = true;
    throw new UpdateRequired(
      "This server no longer supports this version of the app — " +
        "install the latest build",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Could not read the chunk manifest for ${platform} ` +
        `(${String(response.status)})`,
    );
  }

  const manifest = (await response.json()) as ChunkManifest;
  if (manifest.baseId !== baseId) reportSkew(manifest.baseId);
  known = manifest.build;
  return manifest;
}

function manifest(): Promise<ChunkManifest> {
  pending ??= fetchManifest().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

function seededModule(file: string): number | undefined {
  return globalThis.__FLYPATH__?.seeded?.[file];
}

async function loadChunk(reference: string): Promise<unknown> {
  const held = globalThis.__FLYPATH__?.chunks?.[reference];
  if (held !== undefined) return globalThis.__r(held);

  if (nativeConfig().dev) {
    const { platform } = nativeConfig();
    await download(
      `/chunk/${platform}/${encodeURIComponent(reference)}.bundle`,
    );
    return requireRegistered(reference);
  }

  const current = await manifest();
  const file = current.chunks[reference];
  if (file === undefined) {
    throw new Error(
      `The server has no chunk for client reference "${reference}"` +
        (current.baseId === nativeConfig().baseId
          ? ""
          : ` — ${skewMessage(current.baseId, nativeConfig().baseId)}`),
    );
  }

  const seed = seededModule(file);
  if (seed !== undefined) {
    const chunks = (globalThis.__FLYPATH__ ??= {} as never).chunks;
    if (chunks) chunks[reference] = seed;
    return globalThis.__r(seed);
  }

  await download(chunkPath(file));
  return requireRegistered(reference);
}

function requireRegistered(reference: string): unknown {
  const moduleId = globalThis.__FLYPATH__?.chunks?.[reference];
  if (moduleId === undefined) {
    throw new Error(`Chunk for "${reference}" did not register a module id`);
  }
  return globalThis.__r(moduleId);
}

export function installClientReferences(): void {
  installBundleLoader();
  setRequireModule({
    load: async (id: string) => {
      const reference = normalizeReferenceId(id);
      const mod = registry[reference] ?? nativeReferences[reference];
      if (mod) return mod;
      const chunk = stripReferenceTag(id);
      assertLocal(chunk);
      return loadChunk(chunk);
    },
  });
}
