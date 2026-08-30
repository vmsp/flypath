import type {
  IndexNode,
  Loader,
  NotFoundNode,
  RouteOptions,
  RouteTree,
} from "./types.ts";

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

export function notFound(load: Loader, options?: RouteOptions): NotFoundNode {
  return { kind: "not-found", load, options: options ?? {} };
}

export function layout<const C extends readonly unknown[]>(
  load: Loader,
  children: C,
): { readonly kind: "layout"; readonly load: Loader; readonly children: C } {
  return { kind: "layout", load, children };
}

export function stack<const C extends readonly unknown[]>(
  children: C,
): { readonly kind: "stack"; readonly children: C } {
  return { kind: "stack", children };
}

export function branches<const C extends readonly unknown[]>(
  load: Loader,
  children: C,
): {
  readonly kind: "branches";
  readonly load: Loader;
  readonly children: C;
} {
  return { kind: "branches", load, children };
}

export function isRouteTree(value: unknown): value is RouteTree {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "routes"
  );
}
