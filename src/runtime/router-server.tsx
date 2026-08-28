import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";

import { NativeNavigator } from "../components/native/navigator.tsx";
import { SafeAreaView } from "../components/safe-area.ts";
import type { BoundaryInfo, FlatRoute } from "../router/flatten.ts";
import { flatten, matchRoutes, ROOT_BOUNDARY } from "../router/flatten.ts";
import type { AnyNode, Params, RouteTree } from "../router/types.ts";

type Wrapper = ComponentType<{ children: ReactNode }>;

type Page = ComponentType<Record<string, never>>;

export type Resolved = {
  routes: readonly FlatRoute[];
  boundaries: ReadonlyMap<string, BoundaryInfo>;
  navigator: BoundaryInfo;
};

const cache = new WeakMap<RouteTree, Resolved>();

export function resolveTree(tree: RouteTree): Resolved {
  const cached = cache.get(tree);
  if (cached) return cached;

  const { routes, boundaries } = flatten(tree);
  const tabs = [...boundaries.values()].find(
    (boundary) => boundary.id !== ROOT_BOUNDARY,
  );
  const resolved: Resolved = {
    routes,
    boundaries,
    navigator: tabs ?? (boundaries.get(ROOT_BOUNDARY) as BoundaryInfo),
  };
  cache.set(tree, resolved);
  return resolved;
}

async function componentOf(node: AnyNode): Promise<ComponentType<never>> {
  return (await node.load()).default;
}

async function wrap(
  chain: readonly AnyNode[],
  inner: ReactNode,
): Promise<ReactNode> {
  let node = inner;
  for (const wrapper of [...chain].reverse()) {
    const Wrap = (await componentOf(wrapper)) as Wrapper;
    node = createElement(Wrap, { children: node });
  }
  return node;
}

export type ScreenRender = {
  route: FlatRoute;
  params: Params;
  node: ReactNode;
};

export async function renderMatch(
  resolved: Resolved,
  route: FlatRoute,
  params: Params,
  boundary: string | undefined,
): Promise<ScreenRender> {
  const skip = new Set<AnyNode>(
    boundary === undefined
      ? []
      : (resolved.boundaries.get(boundary)?.ancestors ?? []),
  );

  const Leaf = (await componentOf(route.leaf)) as Page;
  const page = createElement(Leaf);
  const chain = route.chain.filter((node) => !skip.has(node));

  return { route, params, node: await wrap(chain, page) };
}

export async function renderScreen(
  resolved: Resolved,
  pathname: string,
  boundary: string | undefined,
): Promise<ScreenRender | undefined> {
  const matched = matchRoutes(resolved.routes, pathname);
  if (!matched) return undefined;
  return renderMatch(resolved, matched.route, matched.params, boundary);
}

export async function renderChrome(resolved: Resolved): Promise<ReactNode> {
  const { navigator } = resolved;

  if (navigator.id === ROOT_BOUNDARY || !navigator.node) {
    return createElement(NativeNavigator, { boundary: ROOT_BOUNDARY });
  }

  const chrome = navigator.ancestors.at(-1) as AnyNode;
  const above = navigator.ancestors.slice(0, -1);
  const Chrome = (await componentOf(chrome)) as Wrapper;

  return wrap(
    above,
    createElement(Chrome, {
      children: createElement(NativeNavigator, { boundary: navigator.id }),
    }),
  );
}

export function fallbackRoute(resolved: Resolved): FlatRoute | undefined {
  return resolved.routes.find((route) => route.pattern.includes("*"));
}

export function withSafeArea(route: FlatRoute, node: ReactNode): ReactNode {
  const { safeArea } = route.options;
  if (safeArea === false) return node;
  return createElement(SafeAreaView, {
    edges: safeArea ?? true,
    children: node,
  });
}
