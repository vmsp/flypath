import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";

import { BranchesHost, StackHost } from "../components/native/navigator.tsx";
import { SafeAreaView } from "../components/safe-area.ts";
import type { ContainerInfo, FlatRoute } from "../router/flatten.ts";
import { flatten, matchRoutes } from "../router/flatten.ts";
import { ContainerScope } from "../router/scope.tsx";
import type {
  AnyNode,
  LoadedNode,
  Params,
  RouteTree,
} from "../router/types.ts";
import type { StrictStyles } from "../styles/types.ts";

type Wrapper = ComponentType<{ children: ReactNode }>;

type Page = ComponentType<Record<string, never>>;

export type Resolved = {
  routes: readonly FlatRoute[];
  fallback: FlatRoute | undefined;
  containers: ReadonlyMap<string, ContainerInfo>;
  scopes: ReadonlyMap<AnyNode, string>;
};

const cache = new WeakMap<RouteTree, Resolved>();

export function resolveTree(tree: RouteTree): Resolved {
  const cached = cache.get(tree);
  if (cached) return cached;

  const { routes, fallback, containers } = flatten(tree);
  const scopes = new Map<AnyNode, string>();
  for (const container of containers.values()) {
    if (container.node) scopes.set(container.node, container.id);
  }

  const resolved: Resolved = { routes, fallback, containers, scopes };
  cache.set(tree, resolved);
  return resolved;
}

async function componentOf(node: LoadedNode): Promise<ComponentType<never>> {
  return (await node.load()).default;
}

async function wrap(
  resolved: Resolved,
  chain: readonly LoadedNode[],
  inner: ReactNode,
): Promise<ReactNode> {
  let node = inner;
  for (const wrapper of [...chain].reverse()) {
    const Wrap = (await componentOf(wrapper)) as Wrapper;
    node = createElement(Wrap, { children: node });
    const id = resolved.scopes.get(wrapper);
    if (id !== undefined) {
      node = createElement(ContainerScope, { id, children: node });
    }
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
  container: string | undefined,
): Promise<ScreenRender> {
  const skip = new Set<AnyNode>(
    container === undefined
      ? []
      : (resolved.containers.get(container)?.ancestors ?? []),
  );

  const Leaf = (await componentOf(route.leaf)) as Page;
  const page = createElement(Leaf);
  const chain = route.chain.filter((node) => !skip.has(node));

  return { route, params, node: await wrap(resolved, chain, page) };
}

export async function renderScreen(
  resolved: Resolved,
  pathname: string,
  container: string | undefined,
): Promise<ScreenRender | undefined> {
  const matched = matchRoutes(resolved.routes, pathname);
  if (!matched) return undefined;
  return renderMatch(resolved, matched.route, matched.params, container);
}

export async function renderFragment(
  resolved: Resolved,
  id: string,
): Promise<ReactNode> {
  const container = resolved.containers.get(id);
  if (!container) {
    throw new Error(`flypath: unknown navigation container "${id}"`);
  }

  const parent =
    container.parent === undefined
      ? undefined
      : resolved.containers.get(container.parent);
  const above = container.ancestors.slice(parent?.ancestors.length ?? 0);
  const Host = container.kind === "branches" ? BranchesHost : StackHost;

  return createElement(ContainerScope, {
    id,
    children: await wrap(resolved, above, createElement(Host, { id })),
  });
}

const ROOT: StrictStyles = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
};

export function withSafeArea(route: FlatRoute, node: ReactNode): ReactNode {
  return createElement(SafeAreaView, {
    edges: route.options.safeArea ?? true,
    style: ROOT,
    children: node,
  });
}
