import { describe, expect, test } from "vitest";

import { matchRoutes } from "../../src/router/path.ts";

describe("route matching", () => {
  test("preserves declaration order for overlapping patterns", () => {
    const dynamic = { pattern: "/p/:id" };
    const fixed = { pattern: "/p/new" };
    expect(matchRoutes([dynamic, fixed], "/p/new")?.route).toBe(dynamic);
    expect(matchRoutes([fixed, dynamic], "/p/new")?.route).toBe(fixed);
  });

  test("normalizes paths and decodes parameters without splitting encoded slashes", () => {
    const routes = [{ pattern: "/p/:id" }];
    expect(matchRoutes(routes, "p/a%2Fb/?q=x#hash")?.params).toEqual({
      id: "a/b",
    });
    expect(matchRoutes(routes, "/p/hello%20world")?.params).toEqual({
      id: "hello world",
    });
    expect(matchRoutes(routes, "/p/a/b")).toBeUndefined();
  });

  test("matches roots and rejects partial matches", () => {
    const routes = [{ pattern: "/" }, { pattern: "/p/:id/edit" }];
    expect(matchRoutes(routes, "/")?.route).toBe(routes[0]);
    expect(matchRoutes(routes, "/p/1")).toBeUndefined();
    expect(matchRoutes(routes, "/p/1/view")).toBeUndefined();
    expect(matchRoutes(routes, "/p/1/edit")?.params).toEqual({ id: "1" });
  });

  test("a replacement route array gets new patterns", () => {
    const original = [{ pattern: "/before" }];
    const replacement = [{ pattern: "/after" }];
    expect(matchRoutes(original, "/before")?.route).toBe(original[0]);
    expect(matchRoutes(replacement, "/before")).toBeUndefined();
    expect(matchRoutes(replacement, "/after")?.route).toBe(replacement[0]);
  });
});
