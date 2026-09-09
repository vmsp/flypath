import { describe, expect, test } from "vitest";

import { prerenderFiles } from "../../src/vite/prerender.ts";

describe("prerenderFiles", () => {
  test("writes the root to index.html with its payload beside it", () => {
    expect(prerenderFiles(["/"])).toEqual([
      { path: "/", document: "index.html", flight: "index.flight" },
    ]);
  });

  test("writes a route to a directory index", () => {
    expect(prerenderFiles(["/about"])).toEqual([
      { path: "/about", document: "about/index.html", flight: "about.flight" },
    ]);
  });

  test("keeps a nested path nested", () => {
    expect(prerenderFiles(["/legal/privacy"])).toEqual([
      {
        path: "/legal/privacy",
        document: "legal/privacy/index.html",
        flight: "legal/privacy.flight",
      },
    ]);
  });

  test("rejects two routes claiming one file", () => {
    expect(() => prerenderFiles(["/about", "/about"])).toThrow(
      /\/about and \/about are both prerendered to about\/index\.html/,
    );
  });
});
