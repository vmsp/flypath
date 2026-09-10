import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { nativePrelude } from "../../src/runtime/native-prelude.ts";
import {
  ageOf,
  forgetChunkManifests,
  nativeTarget,
  skewResponse,
  withoutFlypathHeaders,
} from "../../src/serve/skew.ts";
import {
  BASE_HEADER,
  BINARY_HEADER,
  BUILD_HEADER,
} from "../../src/shared/headers.ts";

const root = process.cwd();

function prelude(dev: boolean, extra: Record<string, unknown> = {}): string {
  return nativePrelude({
    root,
    platform: "ios",
    dev,
    serverUrl: "https://example.com",
    manifestHash: "mh",
    baseId: "base-1",
    build: "build-1",
    ...extra,
  });
}

describe("the release prelude", () => {
  test("makes __DEV__ a literal false and NODE_ENV production", () => {
    const code = prelude(false);
    expect(code).toContain("__GLOBAL__.__DEV__ = false;");
    expect(code).toContain('__GLOBAL__.process.env.NODE_ENV = "production";');
  });

  test("keeps the dev prelude as it was", () => {
    const code = prelude(true);
    expect(code).toContain("__GLOBAL__.__DEV__ = true;");
    expect(code).toContain('__GLOBAL__.process.env.NODE_ENV = "development";');
  });

  test("bakes the configured url, the baseId and the build", () => {
    const code = prelude(false);
    expect(code).toContain('serverUrl: "https://example.com"');
    expect(code).toContain('baseId: "base-1"');
    expect(code).toContain('build: "build-1"');
  });

  test("carries the chunk seed", () => {
    const code = prelude(false, { seeded: { "k-h.bundle": 42 } });
    expect(code).toContain('seeded: {"k-h.bundle":42}');
  });

  test("has an empty seed when nothing was seeded", () => {
    expect(prelude(false)).toContain("seeded: {}");
  });
});

let client: string;

beforeEach(() => {
  client = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-skew-"));
  fs.mkdirSync(path.join(client, "native"), { recursive: true });
  fs.writeFileSync(
    path.join(client, "native", "ios.json"),
    JSON.stringify({ baseId: "base-1", build: "mtv00000-aaaaaa", chunks: {} }),
  );
  forgetChunkManifests();
});

afterEach(() => {
  fs.rmSync(client, { recursive: true, force: true });
  forgetChunkManifests();
});

function ask(
  pathname: string,
  headers: Record<string, string>,
  minimumBuild?: string,
): Response | undefined {
  return skewResponse(new Request(`http://x${pathname}`, { headers }), {
    clientDir: client,
    minimumBuild,
  });
}

describe("nativeTarget", () => {
  test("names the platform of a chunk or a manifest path", () => {
    expect(nativeTarget("/chunk/ios/k-h.bundle")).toBe("ios");
    expect(nativeTarget("/native/android.json")).toBe("android");
  });

  test("is undefined for anything else", () => {
    expect(nativeTarget("/assets/app.js")).toBeUndefined();
    expect(nativeTarget("/about.flight")).toBeUndefined();
  });
});

describe("skewResponse", () => {
  test("lets a matching base through", () => {
    expect(
      ask("/native/ios.json", { [BASE_HEADER]: "base-1" }),
    ).toBeUndefined();
    expect(
      ask("/chunk/ios/k-h.bundle", { [BASE_HEADER]: "base-1" }),
    ).toBeUndefined();
  });

  test("answers 409 to a base the server no longer serves", () => {
    const response = ask("/native/ios.json", { [BASE_HEADER]: "base-0" });
    expect(response?.status).toBe(409);
    expect(response?.headers.get(BUILD_HEADER)).toBe("mtv00000-aaaaaa");
  });

  test("says nothing when the request declares no base", () => {
    expect(ask("/native/ios.json", {})).toBeUndefined();
  });

  test("says nothing for a path that is not a chunk or a manifest", () => {
    expect(ask("/about", { [BASE_HEADER]: "base-0" })).toBeUndefined();
  });

  test("answers 426 to a binary older than minimumBuild", () => {
    const response = ask(
      "/native/ios.json",
      { [BASE_HEADER]: "base-1", [BINARY_HEADER]: "mtu00000-zzzzzz" },
      "mtv00000-aaaaaa",
    );
    expect(response?.status).toBe(426);
  });

  test("lets a binary at or after minimumBuild through", () => {
    expect(
      ask(
        "/native/ios.json",
        { [BASE_HEADER]: "base-1", [BINARY_HEADER]: "mtv00000-aaaaaa" },
        "mtv00000-aaaaaa",
      ),
    ).toBeUndefined();
    expect(
      ask(
        "/native/ios.json",
        { [BASE_HEADER]: "base-1", [BINARY_HEADER]: "mtw00000-aaaaaa" },
        "mtv00000-aaaaaa",
      ),
    ).toBeUndefined();
  });

  test("compares only the time half of a build id", () => {
    expect(ageOf("mtvp9icr-1rjnrd")).toBe("mtvp9icr");
  });
});

describe("withoutFlypathHeaders", () => {
  test("strips every flypath header and keeps the rest", () => {
    const request = new Request("http://x/chunk/ios/k.bundle", {
      headers: {
        [BASE_HEADER]: "base-1",
        [BINARY_HEADER]: "build-1",
        "accept-encoding": "br",
      },
    });
    const stripped = withoutFlypathHeaders(request);
    expect(stripped.headers.get(BASE_HEADER)).toBeNull();
    expect(stripped.headers.get("accept-encoding")).toBe("br");
  });

  test("hands back the same request when there is nothing to strip", () => {
    const request = new Request("http://x/assets/a.js");
    expect(withoutFlypathHeaders(request)).toBe(request);
  });
});
