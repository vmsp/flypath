import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

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

async function get(
  pathname: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<Response | undefined> {
  return serveStatic(new Request(`http://x${pathname}`, { method, headers }), {
    dir,
    compress: true,
  });
}

async function must(
  pathname: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await get(pathname, headers);
  if (!response) throw new Error(`${pathname} did not resolve`);
  return response;
}

describe("resolution", () => {
  test("finds an exact file", async () => {
    expect((await resolveFile(dir, "/about.flight"))?.relative).toBe(
      "about.flight",
    );
  });

  test("falls back to index.html in a directory", async () => {
    expect((await resolveFile(dir, "/about"))?.relative).toBe(
      path.join("about", "index.html"),
    );
    expect((await resolveFile(dir, "/"))?.relative).toBe("index.html");
  });

  test("prefers the exact file over the directory index", async () => {
    expect((await resolveFile(dir, "/index.html"))?.relative).toBe(
      "index.html",
    );
  });

  test("misses when nothing matches", async () => {
    expect(await resolveFile(dir, "/nope")).toBeUndefined();
  });
});

describe("traversal", () => {
  test("refuses to climb out with ..", async () => {
    expect(await resolveFile(dir, "/../secret.txt")).toBeUndefined();
    expect(await resolveFile(dir, "/a/../../secret.txt")).toBeUndefined();
  });

  test("refuses an encoded climb", async () => {
    expect(await resolveFile(dir, "/%2e%2e%2fsecret.txt")).toBeUndefined();
    expect(await resolveFile(dir, "/..%2fsecret.txt")).toBeUndefined();
  });

  test("refuses a NUL byte", async () => {
    expect(await resolveFile(dir, "/index.html%00.png")).toBeUndefined();
  });

  test("refuses a symlink that leaves the root", async () => {
    expect(await resolveFile(dir, "/escape.txt")).toBeUndefined();
  });
});

describe("the x-flypath bypass", () => {
  test("skips the static layer for a native request", async () => {
    expect(
      await get("/about", { "x-flypath-platform": "ios" }),
    ).toBeUndefined();
    expect(await get("/about", { "x-flypath-screen": "root" })).toBeUndefined();
  });

  test("serves the same path with no flypath header", async () => {
    expect((await get("/about"))?.status).toBe(200);
  });

  test("skips a non-GET method", async () => {
    expect(await get("/about", {}, "POST")).toBeUndefined();
  });
});

describe("cache classes", () => {
  test("content-hashed output is immutable", async () => {
    expect(cacheControl("assets/app-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControl(path.join("chunk", "ios", "k-h.bundle"))).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("the manifest and documents must revalidate", async () => {
    expect(cacheControl("native/ios.json")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(cacheControl("about/index.html")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("the served response carries the class", async () => {
    expect(
      (await get("/assets/app-abc123.js"))?.headers.get("cache-control"),
    ).toBe("public, max-age=31536000, immutable");
    expect((await get("/native/ios.json"))?.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});

describe("content types", () => {
  test("names a flight payload", async () => {
    expect(contentType("about.flight")).toBe("text/x-component;charset=utf-8");
    expect((await get("/about.flight"))?.headers.get("content-type")).toBe(
      "text/x-component;charset=utf-8",
    );
  });

  test("names the ordinary ones", async () => {
    expect(contentType("a.html")).toBe("text/html;charset=utf-8");
    expect(contentType("a.js")).toBe("text/javascript;charset=utf-8");
    expect(contentType("a.bundle")).toBe(
      "application/javascript;charset=utf-8",
    );
    expect(contentType("a.unknown")).toBe("application/octet-stream");
  });
});

describe("conditional requests", () => {
  test("answers 304 to a matching etag", async () => {
    const tag = String((await must("/about.flight")).headers.get("etag"));
    expect(tag).toMatch(/^W\//);
    expect((await must("/about.flight", { "if-none-match": tag })).status).toBe(
      304,
    );
  });

  test("answers 304 to a fresh if-modified-since", async () => {
    const modified = String(
      (await must("/about.flight")).headers.get("last-modified"),
    );
    expect(Number.isNaN(Date.parse(modified))).toBe(false);
    expect(
      (await must("/about.flight", { "if-modified-since": modified })).status,
    ).toBe(304);
  });

  test("answers 200 to a stale etag", async () => {
    expect(
      (await get("/about.flight", { "if-none-match": 'W/"0-0"' }))?.status,
    ).toBe(200);
  });
});

describe("ranges", () => {
  test("parses the three shapes", async () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  test("rejects a range past the end", async () => {
    expect(parseRange("bytes=200-300", 100)).toBe("unsatisfiable");
  });

  test("serves 206 with a content-range", async () => {
    const response = await get("/about.flight", { range: "bytes=0-4" });
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toMatch(/^bytes 0-4\/\d+$/);
    expect(response?.headers.get("content-length")).toBe("5");
  });

  test("serves 416 for an unsatisfiable range", async () => {
    const response = await get("/about.flight", { range: "bytes=9999-" });
    expect(response?.status).toBe(416);
  });
});

describe("encodings", () => {
  test("ignores a compressed sidecar outside the root", async () => {
    const file = path.join(dir, "outside.txt");
    await fs.promises.writeFile(file, "plain");
    await fs.promises.symlink(path.join(outside, "secret.txt"), file + ".gz");
    const response = await must("/outside.txt", { "accept-encoding": "gzip" });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe("plain");
  });

  test("prefers a precompressed sidecar the client accepts", async () => {
    const response = await get("/big.txt", {
      "accept-encoding": "gzip, deflate",
    });
    expect(response?.headers.get("content-encoding")).toBe("gzip");
    expect(response?.headers.get("vary")).toBe("Accept-Encoding");
  });

  test("serves the plain file when the encoding is not accepted", async () => {
    const response = await get("/big.txt", { "accept-encoding": "identity" });
    expect(response?.headers.get("content-encoding")).toBeNull();
  });

  test("ignores a sidecar that does not exist", async () => {
    const response = await get("/about.flight", { "accept-encoding": "gzip" });
    expect(response?.headers.get("content-encoding")).toBeNull();
  });
});

describe("HEAD", () => {
  test("carries the headers and no body", async () => {
    const response = await get("/about.flight", {}, "HEAD");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBeTruthy();
    expect(await response?.text()).toBe("");
  });
});

test("serves bytes without synchronous metadata calls and sees updated files", async () => {
  const file = path.join(dir, "changing.txt");
  await fs.promises.writeFile(file, "before");
  const stat = vi.spyOn(fs, "statSync").mockImplementation(() => {
    throw new Error("synchronous stat");
  });
  const realpath = vi.spyOn(fs, "realpathSync").mockImplementation(() => {
    throw new Error("synchronous realpath");
  });
  try {
    expect(await (await must("/changing.txt")).text()).toBe("before");
    await fs.promises.writeFile(file, "after");
    expect(await (await must("/changing.txt")).text()).toBe("after");
    expect(
      await (await must("/about.flight", { range: "bytes=0-3" })).text(),
    ).toBe("0:fl");
    expect(stat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  } finally {
    stat.mockRestore();
    realpath.mockRestore();
  }
});
