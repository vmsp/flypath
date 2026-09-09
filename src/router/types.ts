import type { ComponentType } from "react";

import type { Register } from "../index.client.ts";
import type { Middleware } from "./middleware.ts";

export type Edge = "top" | "bottom" | "left" | "right";

export type Presentation = "push" | "modal";

export type Transition = "platform" | "fade" | "none";

export type Revalidation = "stale" | "blocking" | "never";

export type RouteOptions = {
  /**
   * Configure screen padding so content does not overlap with system UI. By
   * default, all edges are padded.
   */
  safeArea?: boolean | readonly Edge[];

  /**
   * How a screen is shown. By default, new screens are pushed into the current
   * navigation stack. `modal` uses a page sheet on iOS, a slide-up on Android
   * and a dialog on web.
   */
  presentation?: Presentation;

  transition?: Transition;

  /**
   * Controls if navigation gestures like edge swipe on iOS and back gesture on
   * Android produce a navigation. Turn it off for a screen that needs the edge
   * for something else. Requires `transition: "platform"` on iOS. Does nothing
   * on web.
   */
  gesture?: boolean;

  /**
   * Fetch this route's payload when a link to it is hovered, so the navigation
   * lands on a warm cache. `isPrefetch()` may be used to detect prefetch
   * requests. Web only.
   */
  prefetch?: "hover" | false;

  /**
   * What a screen does once its content has gone stale. By default the old
   * render stays up and is swapped when the refetch resolves. `blocking` drops
   * it and refetches first, for screens where the previous render is a privacy
   * problem. `never` treats the route as immutable until `revalidate.reset()`.
   */
  revalidate?: Revalidation;

  staleTime?: number;

  /**
   * Render this route once during `flypath build` and serve the result as a
   * file. Nothing about the request is readable while it renders — no cookies,
   * headers or query — and no middleware may run over it, so every visitor gets
   * the same page. Web only. Native renders it on demand like any other route.
   */
  prerender?: boolean;
};

export type MiddlewareOptions = {
  middleware?: readonly Middleware[];
};

export type RootOptions = MiddlewareOptions & {
  /**
   * Where the native app opens, `"/"` unless set. Web opens whatever URL was
   * visited, so this moves the app's first screen only. Set it when the index
   * route is a web page the app should not start on.
   */
  launch?: string;
};

export type NodeOptions = RouteOptions & MiddlewareOptions;

type Guarded = {
  readonly middleware?: readonly Middleware[];
};

export type Loader = () => Promise<{ default: ComponentType<never> }>;

export type RouteNode = Guarded & {
  readonly kind: "route";
  readonly pattern: string;
  readonly load: Loader;
  readonly options: RouteOptions;
  readonly children: readonly AnyNode[];
};

export type IndexNode = Guarded & {
  readonly kind: "index";
  readonly load: Loader;
  readonly options: RouteOptions;
};

export type NotFoundNode = Guarded & {
  readonly kind: "not-found";
  readonly load: Loader;
  readonly options: RouteOptions;
};

export type LayoutNode = Guarded & {
  readonly kind: "layout";
  readonly load: Loader;
  readonly children: readonly AnyNode[];
};

export type StackNode = Guarded & {
  readonly kind: "stack";
  readonly children: readonly AnyNode[];
};

export type BranchesNode = Guarded & {
  readonly kind: "branches";
  readonly load: Loader;
  readonly children: readonly AnyNode[];
};

export type AnyNode =
  | RouteNode
  | IndexNode
  | NotFoundNode
  | LayoutNode
  | StackNode
  | BranchesNode;

export type LoadedNode = Exclude<AnyNode, StackNode>;

export type RouteTree = Guarded & {
  readonly kind: "routes";
  readonly launch?: string;
  readonly children: readonly AnyNode[];
};

type Trim<S extends string> = S extends `/${infer R}`
  ? Trim<R>
  : S extends `${infer R}/`
    ? Trim<R>
    : S;

type Fill<S extends string> = S extends `${infer H}/${infer T}`
  ? `${Segment<H>}/${Fill<T>}`
  : Segment<S>;

type Segment<S extends string> = S extends `:${string}` ? string : S;

type Item<C> = C extends readonly unknown[] ? C[number] : never;

type Root<Base extends string> = Base extends "" ? "/" : Base;

type Branch<S extends string, Base extends string, C> =
  | `${Base}/${S}`
  | Under<Item<C>, `${Base}/${S}`>;

type Container = "layout" | "stack" | "branches";

type Under<N, Base extends string> = N extends IndexNode
  ? Root<Base>
  : N extends { kind: Container; children: infer C }
    ? Under<Item<C>, Base>
    : N extends { kind: "route"; pattern: infer P; children: infer C }
      ? P extends string
        ? Branch<Fill<Trim<P>>, Base, C>
        : never
      : never;

type DeclaredBranch<S extends string, Base extends string, C> =
  | `${Base}/${S}`
  | Declared<Item<C>, `${Base}/${S}`>;

type Declared<N, Base extends string> = N extends IndexNode
  ? Root<Base>
  : N extends { kind: Container; children: infer C }
    ? Declared<Item<C>, Base>
    : N extends { kind: "route"; pattern: infer P; children: infer C }
      ? P extends string
        ? DeclaredBranch<Trim<P>, Base, C>
        : never
      : never;

type Registered = Register extends { routes: infer R } ? R : never;

type TreePaths<T> = T extends { kind: "routes"; children: infer C }
  ? Under<Item<C>, "">
  : string;

type TreePatterns<T> = T extends { kind: "routes"; children: infer C }
  ? Declared<Item<C>, "">
  : string;

export type Href = [Registered] extends [never]
  ? string
  : TreePaths<Registered>;

export type Pattern = [Registered] extends [never]
  ? string
  : TreePatterns<Registered>;

export type ExternalHref =
  | `http://${string}`
  | `https://${string}`
  | `mailto:${string}`
  | `tel:${string}`
  | `#${string}`;

type NameOf<S extends string> = S extends `:${infer N}` ? N : never;

type ParamNames<P> = P extends `${infer H}/${infer T}`
  ? NameOf<H> | ParamNames<T>
  : P extends string
    ? NameOf<P>
    : never;

type ParamValue = string | number | boolean | null | undefined;

type ParamInput = ParamValue | readonly ParamValue[];

type Filled<P> = { [K in ParamNames<P>]: string | number | boolean };

type ParamBag<P> = Filled<P> & { readonly [key: string]: ParamInput };

export type HrefArgs<P> = [ParamNames<P>] extends [never]
  ? [params?: ParamBag<P>]
  : [params: ParamBag<P>];

export type Params = Record<string, string>;

export type SearchParams = Record<string, string>;

export type Search = Readonly<Record<string, readonly string[]>>;

export type RouteInfo = {
  readonly pathname: string;
  readonly params: Params;
  readonly search: Search;
};

export type Destination = Href | Pattern | ExternalHref | "back" | "not-found";

export type Mode = "push" | "replace";

export type Navigate = {
  /** Answer the request with the not-found route. Server only. */
  (to: "not-found"): never;
  /**
   * Go to a route, `"back"`, or an external URL, filling in the params the
   * pattern declares. Pushes from an action, replaces during a render.
   */
  <const P extends Destination>(to: P, ...args: HrefArgs<P>): void;
  /** Navigate, always adding a history entry. */
  push: <const P extends Destination>(to: P, ...args: HrefArgs<P>) => void;
  /** Navigate, replacing the current history entry. */
  replace: <const P extends Destination>(to: P, ...args: HrefArgs<P>) => void;
  /** Redirect permanently (HTTP 308). Server only. */
  permanent: <const P extends Destination>(
    to: P,
    ...args: HrefArgs<P>
  ) => never;
};

export type Revalidate = {
  /** Mark what a mutation invalidated, refetching the visible screens. */
  (): void;
  /** Also drop cached screens that aren't visible. */
  reset: () => void;
  /** Keep everything; the mutation changed nothing that is rendered. */
  none: () => void;
};

export type ParamsReader = {
  /** Read one path param of the current route. */
  (name: string): string;
  /** Read every path param of the current route. */
  (): Params;
};

export type QueryReader = {
  /** Read the first value of a search param. */
  (name: string): string | undefined;
  /** Read the whole query string. */
  (): SearchParams;
  /** Read every value of a repeated search param. */
  all: (name: string) => readonly string[];
};
