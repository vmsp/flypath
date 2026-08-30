import type { ComponentType } from "react";

import type { Register } from "../index.ts";

export type Edge = "top" | "bottom" | "left" | "right";

export type Presentation = "push" | "modal";

export type RouteOptions = {
  safeArea?: boolean | readonly Edge[];
  presentation?: Presentation;
  prefetch?: "hover" | false;
};

export type Loader = () => Promise<{ default: ComponentType<never> }>;

export type RouteNode = {
  readonly kind: "route";
  readonly pattern: string;
  readonly load: Loader;
  readonly options: RouteOptions;
  readonly children: readonly AnyNode[];
};

export type IndexNode = {
  readonly kind: "index";
  readonly load: Loader;
  readonly options: RouteOptions;
};

export type NotFoundNode = {
  readonly kind: "not-found";
  readonly load: Loader;
  readonly options: RouteOptions;
};

export type LayoutNode = {
  readonly kind: "layout";
  readonly load: Loader;
  readonly children: readonly AnyNode[];
};

export type StackNode = {
  readonly kind: "stack";
  readonly children: readonly AnyNode[];
};

export type BranchesNode = {
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

export type RouteTree = {
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

type ParamValues<P> = { [K in ParamNames<P>]: string };

export type HrefArgs<P> = [ParamNames<P>] extends [never]
  ? []
  : [params: ParamValues<P>];

export type Params = Record<string, string>;

export type SearchParams = Record<string, string | string[]>;

export type Navigation = {
  pathname: string;
  params: Params;
  searchParams: SearchParams;
};

export type RouteParams<P> = [P] extends [never]
  ? Params
  : string extends P
    ? Params
    : { [K in ParamNames<P>]: string };
