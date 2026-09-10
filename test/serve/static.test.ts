import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  cacheControl,
  contentType,
  parseRange,
  resolveFile,
  serveStatic,
} from "../../src/serve/static.ts";

let dir: string;
let outside: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-static-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-outside-"));

  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "chunk", "ios"), { recursive: true });
  fs.mkdirSync(path.join(dir, "about"), { recursive: true });
  fs.mkdirSync(path.join(dir, "native"), { recursive: true });

  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>root");
  fs.writeFileSync(
    path.join(dir, "about", "index.html"),
    "<!doctype html>about",
  );
  fs.writeFileSync(path.join(dir, "about.flight"), "0:flight-payload");
  fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "chunk", "ios", "k-h.bundle"), "__d(1)");
  fs.writeFileSync(path.join(dir, "native", "ios.json"), "{}");
  fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(4096));
  fs.writeFileSync(path.join(dir, "big.txt.gz"), "gzipped-bytes");
  fs.writeFileSync(path.join(outside, "secret.txt"), "shhh");
  fs.symlinkSync(
    path.join(outside, "secret.txt"),
    path.join(dir, "escape.txt"),
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function get(
  pathname: string,
  headers: Record<string, string> = {},
  method = "GET",
): Response | undefined {
  return serveStatic(new Request(`http://x${pathname}`, { method, headers }), {
    dir,
    compress: true,
  });
}

function must(
  pathname: string,
  headers: Record<string, string> = {},
): Response {
  const response = get(pathname, headers);
  if (!response) throw new Error(`flypath: ${pathname} did not resolve`);
  return response;
}

describe("resolution", () => {
  test("finds an exact file", () => {
    expect(resolveFile(dir, "/about.flight")?.relative).toBe("about.flight");
  });

  test("falls back to index.html in a directory", () => {
    expect(resolveFile(dir, "/about")?.relative).toBe(
      path.join("about", "index.html"),
    );
    expect(resolveFile(dir, "/")?.relative).toBe("index.html");
  });

  test("prefers the exact file over the directory index", () => {
    expect(resolveFile(dir, "/index.html")?.relative).toBe("index.html");
  });

  test("misses when nothing matches", () => {
    expect(resolveFile(dir, "/nope")).toBeUndefined();
  });
});

describe("traversal", () => {
  test("refuses to climb out with ..", () => {
    expect(resolveFile(dir, "/../secret.txt")).toBeUndefined();
    expect(resolveFile(dir, "/a/../../secret.txt")).toBeUndefined();
  });

  test("refuses an encoded climb", () => {
    expect(resolveFile(dir, "/%2e%2e%2fsecret.txt")).toBeUndefined();
    expect(resolveFile(dir, "/..%2fsecret.txt")).toBeUndefined();
  });

  test("refuses a NUL byte", () => {
    expect(resolveFile(dir, "/index.html%00.png")).toBeUndefined();
  });

  test("refuses a symlink that leaves the root", () => {
    expect(resolveFile(dir, "/escape.txt")).toBeUndefined();
  });
});

describe("the x-flypath bypass", () => {
  test("skips the static layer for a native request", () => {
    expect(get("/about", { "x-flypath-platform": "ios" })).toBeUndefined();
    expect(get("/about", { "x-flypath-screen": "root" })).toBeUndefined();
  });

  test("serves the same path with no flypath header", () => {
    expect(get("/about")?.status).toBe(200);
  });

  test("skips a non-GET method", () => {
    expect(get("/about", {}, "POST")).toBeUndefined();
  });
});

describe("cache classes", () => {
  test("content-hashed output is immutable", () => {
    expect(cacheControl("assets/app-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControl(path.join("chunk", "ios", "k-h.bundle"))).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("the manifest and documents must revalidate", () => {
    expect(cacheControl("native/ios.json")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(cacheControl("about/index.html")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("the served response carries the class", () => {
    expect(get("/assets/app-abc123.js")?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(get("/native/ios.json")?.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});

describe("content types", () => {
  test("names a flight payload", () => {
    expect(contentType("about.flight")).toBe("text/x-component;charset=utf-8");
    expect(get("/about.flight")?.headers.get("content-type")).toBe(
      "text/x-component;charset=utf-8",
    );
  });

  test("names the ordinary ones", () => {
    expect(contentType("a.html")).toBe("text/html;charset=utf-8");
    expect(contentType("a.js")).toBe("text/javascript;charset=utf-8");
    expect(contentType("a.bundle")).toBe(
      "application/javascript;charset=utf-8",
    );
    expect(contentType("a.unknown")).toBe("application/octet-stream");
  });
});

describe("conditional requests", () => {
  test("answers 304 to a matching etag", () => {
    const tag = String(must("/about.flight").headers.get("etag"));
    expect(tag).toMatch(/^W\//);
    expect(must("/about.flight", { "if-none-match": tag }).status).toBe(304);
  });

  test("answers 304 to a fresh if-modified-since", () => {
    const modified = String(must("/about.flight").headers.get("last-modified"));
    expect(Number.isNaN(Date.parse(modified))).toBe(false);
    expect(
      must("/about.flight", { "if-modified-since": modified }).status,
    ).toBe(304);
  });

  test("answers 200 to a stale etag", () => {
    expect(get("/about.flight", { "if-none-match": 'W/"0-0"' })?.status).toBe(
      200,
    );
  });
});

describe("ranges", () => {
  test("parses the three shapes", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  test("rejects a range past the end", () => {
    expect(parseRange("bytes=200-300", 100)).toBe("unsatisfiable");
  });

  test("serves 206 with a content-range", () => {
    const response = get("/about.flight", { range: "bytes=0-4" });
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toMatch(/^bytes 0-4\/\d+$/);
    expect(response?.headers.get("content-length")).toBe("5");
  });

  test("serves 416 for an unsatisfiable range", () => {
    const response = get("/about.flight", { range: "bytes=9999-" });
    expect(response?.status).toBe(416);
  });
});

describe("encodings", () => {
  test("prefers a precompressed sidecar the client accepts", () => {
    const response = get("/big.txt", { "accept-encoding": "gzip, deflate" });
    expect(response?.headers.get("content-encoding")).toBe("gzip");
    expect(response?.headers.get("vary")).toBe("Accept-Encoding");
  });

  test("serves the plain file when the encoding is not accepted", () => {
    const response = get("/big.txt", { "accept-encoding": "identity" });
    expect(response?.headers.get("content-encoding")).toBeNull();
  });

  test("ignores a sidecar that does not exist", () => {
    const response = get("/about.flight", { "accept-encoding": "gzip" });
    expect(response?.headers.get("content-encoding")).toBeNull();
  });
});

describe("HEAD", () => {
  test("carries the headers and no body", async () => {
    const response = get("/about.flight", {}, "HEAD");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBeTruthy();
    expect(await response?.text()).toBe("");
  });
});
