import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import rsc from "@vitejs/plugin-rsc";
import { createServer, isRunnableDevEnvironment } from "vite";
import type { ViteDevServer } from "vite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import type { Handler } from "../../src/runtime/prerender.ts";
import { nativeStub } from "../../src/vite/native-stub.ts";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = path.join(import.meta.dirname, "fixtures/streaming.tsx");
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-rsc-"));
let server: ViteDevServer;
let handler: Handler;
let controls: typeof import("./fixtures/streaming.tsx");

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root,
    cacheDir: cache,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [
      nativeStub(path.join(root, "src/components/native")),
      {
        name: "streaming-fixtures",
        resolveId(id) {
          if (id.startsWith("virtual:flypath/")) return "\0" + id;
        },
        load(id) {
          if (id === "\0virtual:flypath/routes")
            return `export { tree } from ${JSON.stringify(fixture)};`;
          if (id === "\0virtual:flypath/build")
            return 'export const buildId = "test";';
          if (id === "\0virtual:flypath/route-manifest")
            return "export const manifest = { routes: [], containers: [] };";
          if (id.startsWith("\0virtual:flypath/")) return "";
        },
      },
      rsc({
        serverHandler: false,
        entries: {
          rsc: path.join(root, "src/runtime/server-entry.tsx"),
          ssr: path.join(root, "src/runtime/ssr-entry.tsx"),
          client: path.join(root, "src/runtime/web-entry.tsx"),
        },
      }),
    ],
  });
  const environment = server.environments["rsc"];
  if (!environment || !isRunnableDevEnvironment(environment))
    throw new Error("Missing RSC runner");
  handler = (
    await environment.runner.import<
      typeof import("../../src/runtime/server-entry.tsx")
    >(path.join(root, "src/runtime/server-entry.tsx"))
  ).default;
  controls = await environment.runner.import(fixture);
}, 30_000);

beforeEach(() => controls.reset());
afterAll(async () => {
  controls?.release();
  await server?.close();
  fs.rmSync(cache, { recursive: true, force: true });
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
) {
  let text = "";
  const decoder = new TextDecoder();
  while (!text.includes(marker)) {
    const next = await reader.read();
    if (next.done) throw new Error(`Stream ended before ${marker}: ${text}`);
    text += decoder.decode(next.value, { stream: true });
  }
  return text;
}

async function readRest(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const next = await reader.read();
    if (next.done) return text + decoder.decode();
    text += decoder.decode(next.value, { stream: true });
  }
}

describe("incremental rendering", () => {
  test.each(["/slow.flight", "/slow"])(
    "streams %s before suspended content resolves",
    async (url) => {
      const response = await handler(
        new Request(`http://test${url}`, {
          headers: { "x-reader": "visitor" },
        }),
      );
      expect(response.headers.get("x-after")).toBe("yes");
      const reader = response.body!.getReader();
      try {
        const initial = await readUntil(reader, "waiting-for-data");
        expect(initial).not.toContain("finished:");
        controls.release();
        const text = await readRest(reader);
        expect(text).toContain("before");
        expect(text).toContain("visitor");
        expect(text).not.toContain("finished:after");
      } finally {
        controls.release();
        await reader.cancel();
      }
    },
    15_000,
  );

  test("keeps middleware redirects and cookies on documents", async () => {
    const response = await handler(new Request("http://test/redirect"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/destination");
    expect(response.headers.getSetCookie()).toEqual(["session=new; Path=/"]);
  });

  test("follows Flight redirects with the updated cookie", async () => {
    const response = await handler(new Request("http://test/redirect.flight"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-flypath-navigate")).toContain(
      "/destination",
    );
    expect(await response.text()).toContain("new");
  });

  test("server actions can redirect with cookies before streaming the destination", async () => {
    const response = await handler(
      new Request("http://test/destination", {
        method: "POST",
        body: "[]",
        headers: { "x-flypath-action": controls.actionId("redirect") },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-flypath-navigate")).toContain(
      "/destination",
    );
    expect(response.headers.getSetCookie()).toEqual(["session=action; Path=/"]);
    expect(await response.text()).toContain("action");
  });

  test("server actions can render the not-found page", async () => {
    const response = await handler(
      new Request("http://test/destination", {
        method: "POST",
        body: "[]",
        headers: { "x-flypath-action": controls.actionId("missing") },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("missing-page");
  });

  test("aborting a request finishes its suspended Flight render", async () => {
    const controller = new AbortController();
    const response = await handler(
      new Request("http://test/slow.flight", { signal: controller.signal }),
    );
    const reader = response.body!.getReader();
    await readUntil(reader, "waiting-for-data");
    controller.abort();
    try {
      await expect(readRest(reader)).resolves.toEqual(expect.any(String));
    } finally {
      controls.release();
      await reader.cancel();
    }
  });

  test.each(["/missing.flight", "/unknown.flight"])(
    "streams the 404 page for %s",
    async (url) => {
      const response = await handler(new Request(`http://test${url}`));
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("missing-page");
    },
  );
});
