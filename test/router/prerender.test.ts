import { describe, expect, test } from "vitest";

import type { RouteManifest } from "../../src/router/manifest.ts";
import { parseRouteTree, routeManifest } from "../../src/vite/route-extract.ts";

const HEADER = `import {
  branches,
  index,
  layout,
  notFound,
  route,
  routes,
  stack,
} from "flypath/router";

import { auth, request } from "./middleware.ts";

`;

function manifest(source: string): RouteManifest {
  return routeManifest(parseRouteTree("app/routes.ts", HEADER + source));
}

function patternOf(value: RouteManifest, pattern: string) {
  return value.routes.find((route) => route.pattern === pattern);
}

describe("prerender", () => {
  test("reaches the manifest as a route option", () => {
    const value = manifest(`export default routes([
      index(() => import("./feed.tsx")),
      route("about", () => import("./about.tsx"), { prerender: true }),
    ]);`);

    expect(patternOf(value, "/about")?.options.prerender).toBe(true);
    expect(patternOf(value, "/")?.options.prerender).toBeUndefined();
  });

  test("rejects a pattern with a param", () => {
    expect(() =>
      manifest(`export default routes([
        route("p/:id", () => import("./post.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(/\/p\/:id has prerender: true but its pattern takes a param/);
  });

  test("rejects a middleware declared on the route", () => {
    expect(() =>
      manifest(`export default routes([
        route("about", () => import("./about.tsx"), {
          middleware: [auth],
          prerender: true,
        }),
      ]);`),
    ).toThrow(
      /the middleware auth\(\) runs over it \(declared on route\("about"\)\)/,
    );
  });

  test("rejects a middleware declared on an ancestor", () => {
    expect(() =>
      manifest(`export default routes({ middleware: [request] }, [
        route("about", () => import("./about.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(
      /the middleware request\(\) runs over it \(declared on routes\(\)\)/,
    );
  });

  test("rejects a middleware declared on a container in between", () => {
    expect(() =>
      manifest(`export default routes([
        layout(() => import("./shell.tsx"), [
          stack({ middleware: [request] }, [
            route("about", () => import("./about.tsx"), { prerender: true }),
          ]),
        ]),
      ]);`),
    ).toThrow(
      /the middleware request\(\) runs over it \(declared on stack\(\)\)/,
    );
  });

  test("allows a middleware on a sibling branch", () => {
    const value = manifest(`export default routes([
      layout(() => import("./shell.tsx"), [
        stack({ middleware: [request] }, [index(() => import("./feed.tsx"))]),
        route("about", () => import("./about.tsx"), { prerender: true }),
      ]),
    ]);`);

    expect(patternOf(value, "/about")?.options.prerender).toBe(true);
  });

  test("rejects a modal", () => {
    expect(() =>
      manifest(`export default routes([
        route("compose", () => import("./compose.tsx"), {
          presentation: "modal",
          prerender: true,
        }),
      ]);`),
    ).toThrow(/has prerender: true and presentation: "modal"/);
  });

  test('rejects a path segment named "index"', () => {
    expect(() =>
      manifest(`export default routes([
        route("docs/index", () => import("./about.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(/a path segment is "index"/);
  });

  test('rejects a path segment ending in ".flight"', () => {
    expect(() =>
      manifest(`export default routes([
        route("about.flight", () => import("./about.tsx"), {
          prerender: true,
        }),
      ]);`),
    ).toThrow(/a path segment ends in "\.flight"/);
  });

  test("rejects the notFound() route", () => {
    expect(() =>
      manifest(`export default routes([
        notFound(() => import("./not-found.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(/notFound\(\) has prerender: true/);
  });

  test("renders under branches() with no middleware", () => {
    const value = manifest(`export default routes([
      branches(() => import("./tab-bar.tsx"), [
        stack([index(() => import("./feed.tsx"))]),
        stack([
          route("about", () => import("./about.tsx"), { prerender: true }),
        ]),
      ]),
    ]);`);

    expect(patternOf(value, "/about")?.options.prerender).toBe(true);
  });
});

describe("launch", () => {
  test("reaches the manifest", () => {
    const value = manifest(`export default routes({ launch: "/feed" }, [
      index(() => import("./landing.tsx")),
      route("feed", () => import("./feed.tsx")),
    ]);`);

    expect(value.launch).toBe("/feed");
  });

  test("is absent when unset", () => {
    const value = manifest(`export default routes([
      index(() => import("./feed.tsx")),
    ]);`);

    expect(value.launch).toBeUndefined();
  });

  test("is required when / is prerendered", () => {
    expect(() =>
      manifest(`export default routes([
        index(() => import("./landing.tsx"), { prerender: true }),
        route("feed", () => import("./feed.tsx")),
      ]);`),
    ).toThrow(/\/ is prerendered but routes\(\) declares no launch/);
  });

  test("rejects a path that is itself prerendered", () => {
    expect(() =>
      manifest(`export default routes({ launch: "/about" }, [
        index(() => import("./feed.tsx")),
        route("about", () => import("./about.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(/routes\(\{ launch: "\/about" \}\) names a prerendered route/);
  });

  test('rejects launch: "/" when / is prerendered', () => {
    expect(() =>
      manifest(`export default routes({ launch: "/" }, [
        index(() => import("./landing.tsx"), { prerender: true }),
      ]);`),
    ).toThrow(/routes\(\{ launch: "\/" \}\) names a prerendered route/);
  });

  test("accepts a launch that points away from a prerendered index", () => {
    const value = manifest(`export default routes({ launch: "/feed" }, [
      index(() => import("./landing.tsx"), { prerender: true }),
      route("feed", () => import("./feed.tsx")),
    ]);`);

    expect(value.launch).toBe("/feed");
  });

  test("rejects a path no route declares", () => {
    expect(() =>
      manifest(`export default routes({ launch: "/nowhere" }, [
        index(() => import("./feed.tsx")),
      ]);`),
    ).toThrow(/routes\(\{ launch: "\/nowhere" \}\) matches no route/);
  });

  test("rejects a path with a param in it", () => {
    expect(() =>
      manifest(`export default routes({ launch: "/p/:id" }, [
        route("p/:id", () => import("./post.tsx")),
      ]);`),
    ).toThrow(/routes\(\{ launch: "\/p\/:id" \}\) takes a param/);
  });
});
