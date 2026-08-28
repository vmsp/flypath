import type { IndexNode, Loader, RouteOptions, RouteTree } from "./types.ts";

export function routes<const C extends readonly unknown[]>(
  children: C,
): { readonly kind: "routes"; readonly children: C } {
  return { kind: "routes", children };
}

export function route<
  const P extends string,
  const C extends readonly unknown[] = readonly [],
>(
  pattern: P,
  load: Loader,
  options?: RouteOptions,
  children?: C,
): {
  readonly kind: "route";
  readonly pattern: P;
  readonly load: Loader;
  readonly options: RouteOptions;
  readonly children: C;
} {
  return {
    kind: "route",
    pattern,
    load,
    options: options ?? {},
    children: (children ?? []) as C,
  };
}

export function index(load: Loader, options?: RouteOptions): IndexNode {
  return { kind: "index", load, options: options ?? {} };
}

export function layout<const C extends readonly unknown[]>(
  load: Loader,
  children: C,
): { readonly kind: "layout"; readonly load: Loader; readonly children: C } {
  return { kind: "layout", load, children };
}

export function tabs<const C extends readonly unknown[]>(
  load: Loader,
  children: C,
): {
  readonly kind: "tabs";
  readonly load: Loader;
  readonly children: C;
} {
  return { kind: "tabs", load, children };
}

export function isRouteTree(value: unknown): value is RouteTree {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "routes"
  );
}
