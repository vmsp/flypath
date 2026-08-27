import { setRequireModule } from "@vitejs/plugin-rsc/core/browser";
import { registry } from "virtual:flypath/client-references";
import { nativeReferences } from "virtual:flypath/native-references";

type Config = {
  platform: string;
  serverUrl: string;
  dev: boolean;
};

type Global = {
  __FLYPATH__: Config;
  __flypathChunks?: Record<string, number>;
  __loadBundleAsync?: (path: string) => Promise<void>;
  __r: (moduleId: number) => unknown;
  globalEvalWithSourceUrl?: (code: string, url: string) => unknown;
};

const scope = globalThis as unknown as Global;

function config(): Config {
  return scope.__FLYPATH__;
}

export function stripReferenceTag(id: string): string {
  let value = id.split("$$")[0] ?? id;
  const query = value.indexOf("?");
  if (query !== -1) value = value.slice(0, query);
  return value;
}

export function normalizeReferenceId(id: string): string {
  const value = stripReferenceTag(id);
  return value.startsWith("/@fs") ? value.slice("/@fs".length) : value;
}

function assertLocal(reference: string): void {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
    throw new Error(
      `flypath: refusing to load client reference "${reference}" — ` +
        "chunks may only be fetched from the configured flypath server",
    );
  }
}

function evaluateChunk(code: string, url: string): void {
  const evaluate = scope.globalEvalWithSourceUrl;
  if (evaluate) evaluate(code, url);
  else (0, eval)(`${code}\n//# sourceURL=${url}\n`);
}

function installBundleLoader(): void {
  if (scope.__loadBundleAsync) return;
  scope.__loadBundleAsync = async (bundlePath: string) => {
    const url = `${config().serverUrl}${bundlePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(
        `flypath: chunk request failed (${response.status}) for ${url}` +
          (reason === "" ? "" : `\n${reason}`),
      );
    }
    evaluateChunk(await response.text(), url);
  };
}

const downloads = new Map<string, Promise<void>>();

function chunkPath(reference: string): string {
  const { platform } = config();
  return `/chunk/${platform}/${encodeURIComponent(reference)}.bundle`;
}

function download(reference: string): Promise<void> {
  const existing = downloads.get(reference);
  if (existing) return existing;

  const load = scope.__loadBundleAsync;
  if (!load) {
    return Promise.reject(
      new Error("flypath: native chunk loader is not installed"),
    );
  }

  const task = load(chunkPath(reference)).catch((error: unknown) => {
    downloads.delete(reference);
    throw error;
  });
  downloads.set(reference, task);
  return task;
}

async function loadChunk(reference: string): Promise<unknown> {
  await download(reference);
  const moduleId = scope.__flypathChunks?.[reference];
  if (moduleId === undefined) {
    throw new Error(
      `flypath: chunk for "${reference}" did not register a module id`,
    );
  }
  return scope.__r(moduleId);
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
