import type { ComponentType } from "react";

import type { Register } from "../index.ts";
import type { Middleware } from "./middleware.ts";

export type Edge = "top" | "bottom" | "left" | "right";

export type Presentation = "push" | "modal";

export type Transition = "platform" | "fade" | "none";

export type Revalidation = "stale" | "blocking" | "never";

export type RouteOptions = {
  safeArea?: boolean | readonly Edge[];
  presentation?: Presentation;
  transition?: Transition;
  gesture?: boolean;
  prefetch?: "hover" | false;
  revalidate?: Revalidation;
  staleTime?: number;
};

export type MiddlewareOptions = {
  middleware?: readonly Middleware[];
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
  (to: "not-found"): never;
  <const P extends Destination>(to: P, ...args: HrefArgs<P>): void;
  push: <const P extends Destination>(to: P, ...args: HrefArgs<P>) => void;
  replace: <const P extends Destination>(to: P, ...args: HrefArgs<P>) => void;
  permanent: <const P extends Destination>(
    to: P,
    ...args: HrefArgs<P>
  ) => never;
};

export type Revalidate = {
  (): void;
  reset: () => void;
  none: () => void;
};

export type ParamsReader = {
  (name: string): string;
  (): Params;
};

export type QueryReader = {
  (name: string): string | undefined;
  (): SearchParams;
  all: (name: string) => readonly string[];
};
