import type { Middleware } from "./middleware.ts";
import type {
  IndexNode,
  Loader,
  MiddlewareOptions,
  NodeOptions,
  NotFoundNode,
  RootOptions,
  RouteOptions,
  RouteTree,
} from "./types.ts";

type Children = readonly unknown[];

type Guard = { readonly middleware: readonly Middleware[] };

type Split = Guard & { readonly options: RouteOptions };

function split(options: NodeOptions | undefined): Split {
  const { middleware, ...rest } = options ?? {};
  return { middleware: middleware ?? [], options: rest };
}

function guard(options: MiddlewareOptions | Children | undefined): Guard {
  if (options === undefined || Array.isArray(options))
    return { middleware: [] };
  return { middleware: (options as MiddlewareOptions).middleware ?? [] };
}

function listOf(
  a: MiddlewareOptions | Children,
  b: Children | undefined,
): Children {
  return Array.isArray(a) ? a : (b ?? []);
}

function launch(options: RootOptions | Children | undefined): {
  launch?: string;
} {
  if (options === undefined || Array.isArray(options)) return {};
  const value = (options as RootOptions).launch;
  return value === undefined ? {} : { launch: value };
}

/** Root of the route tree. The default export of `app/routes.ts`. */
export function routes<const C extends Children>(
  children: C,
): { readonly kind: "routes"; readonly children: C };
export function routes<const C extends Children>(
  options: RootOptions,
  children: C,
): { readonly kind: "routes"; readonly children: C };
export function routes(
  options: RootOptions | Children,
  children?: Children,
): { readonly kind: "routes"; readonly children: Children } {
  return {
    kind: "routes",
    children: listOf(options, children),
    ...guard(options),
    ...launch(options),
  };
}

/** A route matching `pattern`, rendering the component `load` imports. */
export function route<
  const P extends string,
  const C extends Children = readonly [],
>(
  pattern: P,
  load: Loader,
  options?: NodeOptions,
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
    ...split(options),
    children: (children ?? []) as C,
  };
}

/** The route rendered when the parent's own path is matched. */
export function index(load: Loader, options?: NodeOptions): IndexNode {
  return { kind: "index", load, ...split(options) };
}

/** The route rendered when nothing else in the tree matches. */
export function notFound(load: Loader, options?: NodeOptions): NotFoundNode {
  return { kind: "not-found", load, ...split(options) };
}

/** Wrap children in a shared component that survives their navigations. */
export function layout<const C extends Children>(
  load: Loader,
  children: C,
): { readonly kind: "layout"; readonly load: Loader; readonly children: C };
export function layout<const C extends Children>(
  load: Loader,
  options: MiddlewareOptions,
  children: C,
): { readonly kind: "layout"; readonly load: Loader; readonly children: C };
export function layout(
  load: Loader,
  options: MiddlewareOptions | Children,
  children?: Children,
): {
  readonly kind: "layout";
  readonly load: Loader;
  readonly children: Children;
} {
  return {
    kind: "layout",
    load,
    children: listOf(options, children),
    ...guard(options),
  };
}

/** Group children into a native stack, pushed and popped as screens. */
export function stack<const C extends Children>(
  children: C,
): { readonly kind: "stack"; readonly children: C };
export function stack<const C extends Children>(
  options: MiddlewareOptions,
  children: C,
): { readonly kind: "stack"; readonly children: C };
export function stack(
  options: MiddlewareOptions | Children,
  children?: Children,
): { readonly kind: "stack"; readonly children: Children } {
  return {
    kind: "stack",
    children: listOf(options, children),
    ...guard(options),
  };
}

/**
 * Group children into parallel branches kept alive side by side, such as tabs.
 * `load` renders the chrome that switches between them.
 */
export function branches<const C extends Children>(
  load: Loader,
  children: C,
): { readonly kind: "branches"; readonly load: Loader; readonly children: C };
export function branches<const C extends Children>(
  load: Loader,
  options: MiddlewareOptions,
  children: C,
): { readonly kind: "branches"; readonly load: Loader; readonly children: C };
export function branches(
  load: Loader,
  options: MiddlewareOptions | Children,
  children?: Children,
): {
  readonly kind: "branches";
  readonly load: Loader;
  readonly children: Children;
} {
  return {
    kind: "branches",
    load,
    children: listOf(options, children),
    ...guard(options),
  };
}

/** Whether a value came from {@link routes}. */
export function isRouteTree(value: unknown): value is RouteTree {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "routes"
  );
}
