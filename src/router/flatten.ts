import { joinPattern, matchPattern } from "./path.ts";
import type { AnyNode, RouteOptions, RouteTree, TabsNode } from "./types.ts";

export const ROOT_BOUNDARY = "root";

export type TabInfo = {
  key: string;
  path: string;
  title?: string;
};

export type BoundaryInfo = {
  id: string;
  node: TabsNode | undefined;
  ancestors: readonly AnyNode[];
  tabs: readonly TabInfo[];
};

export type FlatRoute = {
  id: string;
  pattern: string;
  options: RouteOptions;
  chain: readonly AnyNode[];
  leaf: AnyNode;
  boundary: string;
  tab?: string;
};

export type Flattened = {
  routes: readonly FlatRoute[];
  boundaries: ReadonlyMap<string, BoundaryInfo>;
};

export function flatten(tree: RouteTree): Flattened {
  const routes: FlatRoute[] = [];
  const boundaries = new Map<string, BoundaryInfo>();
  const ids = new Set<string>();
  let counter = 0;

  boundaries.set(ROOT_BOUNDARY, {
    id: ROOT_BOUNDARY,
    node: undefined,
    ancestors: [],
    tabs: [],
  });

  const uniqueId = (pattern: string): string => {
    if (!ids.has(pattern)) {
      ids.add(pattern);
      return pattern;
    }
    let suffix = 2;
    while (ids.has(`${pattern}@${suffix}`)) suffix += 1;
    const id = `${pattern}@${suffix}`;
    ids.add(id);
    return id;
  };

  const emit = (
    pattern: string,
    leaf: AnyNode,
    options: RouteOptions,
    chain: readonly AnyNode[],
    boundary: string,
    tab: string | undefined,
  ): FlatRoute => {
    const route: FlatRoute = {
      id: uniqueId(pattern),
      pattern,
      options,
      chain,
      leaf,
      boundary,
      ...(tab === undefined ? {} : { tab }),
    };
    routes.push(route);
    return route;
  };

  const walk = (
    nodes: readonly AnyNode[],
    base: string,
    chain: readonly AnyNode[],
    boundary: string,
    tab: string | undefined,
  ): void => {
    for (const node of nodes) {
      if (node.kind === "index") {
        emit(
          base === "" ? "/" : base,
          node,
          node.options,
          chain,
          boundary,
          tab,
        );
        continue;
      }
      if (node.kind === "layout") {
        walk(node.children, base, [...chain, node], boundary, tab);
        continue;
      }
      if (node.kind === "tabs") {
        const id = `#${counter}`;
        counter += 1;
        const nested = [...chain, node];
        const tabInfos: TabInfo[] = [];
        boundaries.set(id, {
          id,
          node,
          ancestors: nested,
          tabs: tabInfos,
        });
        for (const [position, child] of node.children.entries()) {
          const key = `${id}:${position}`;
          const before = routes.length;
          walk([child], base, nested, id, key);
          const first = routes[before];
          if (!first) continue;
          tabInfos.push({
            key,
            path: first.pattern,
            ...(first.options.title === undefined
              ? {}
              : { title: first.options.title }),
          });
        }
        continue;
      }

      const pattern = joinPattern(base, node.pattern);
      if (node.children.length === 0) {
        emit(pattern, node, node.options, chain, boundary, tab);
        continue;
      }
      walk(node.children, pattern, [...chain, node], boundary, tab);
    }
  };

  walk(tree.children, "", [], ROOT_BOUNDARY, undefined);

  return { routes, boundaries };
}

export function matchRoutes(
  routes: readonly FlatRoute[],
  pathname: string,
): { route: FlatRoute; params: Record<string, string> } | undefined {
  for (const route of routes) {
    const params = matchPattern(route.pattern, pathname);
    if (params) return { route, params };
  }
  return undefined;
}
