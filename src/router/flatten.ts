import type { ContainerKind } from "./manifest.ts";
import { ROOT_CONTAINER, SHARED } from "./manifest.ts";
import { joinPattern, matchPattern } from "./path.ts";
import type {
  AnyNode,
  LoadedNode,
  BranchesNode,
  RouteOptions,
  RouteTree,
} from "./types.ts";

export type ContainerInfo = {
  id: string;
  kind: ContainerKind;
  parent: string | undefined;
  node: BranchesNode | undefined;
  ancestors: readonly LoadedNode[];
  branches: string[];
  root: string;
};

export type FlatRoute = {
  id: string;
  pattern: string;
  options: RouteOptions;
  chain: readonly LoadedNode[];
  leaf: LoadedNode;
  placement: readonly string[];
};

export type Flattened = {
  routes: readonly FlatRoute[];
  containers: ReadonlyMap<string, ContainerInfo>;
};

export function flatten(tree: RouteTree): Flattened {
  const routes: FlatRoute[] = [];
  const containers = new Map<string, ContainerInfo>();
  const ids = new Set<string>();
  const rooted = new Set<string>();
  let counter = 0;

  containers.set(ROOT_CONTAINER, {
    id: ROOT_CONTAINER,
    kind: "stack",
    parent: undefined,
    node: undefined,
    ancestors: [],
    branches: [],
    root: "/",
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
    leaf: LoadedNode,
    options: RouteOptions,
    chain: readonly LoadedNode[],
    placement: readonly string[],
  ): void => {
    routes.push({
      id: uniqueId(pattern),
      pattern,
      options,
      chain,
      leaf,
      placement,
    });
    for (const id of placement) {
      if (id === SHARED || rooted.has(id)) continue;
      rooted.add(id);
      const container = containers.get(id);
      if (container) container.root = pattern;
    }
  };

  const walk = (
    nodes: readonly AnyNode[],
    base: string,
    chain: readonly LoadedNode[],
    placement: readonly string[],
    shared: ContainerInfo | undefined,
  ): void => {
    const of = (): readonly string[] =>
      shared ? [...placement, SHARED] : placement;

    for (const node of nodes) {
      if (node.kind === "index") {
        emit(base === "" ? "/" : base, node, node.options, chain, of());
        continue;
      }

      if (node.kind === "layout") {
        walk(node.children, base, [...chain, node], placement, shared);
        continue;
      }

      if (node.kind === "stack" || node.kind === "branches") {
        const id = `#${counter}`;
        counter += 1;
        const parent = placement.at(-1) ?? ROOT_CONTAINER;
        const branching = node.kind === "branches";
        const ancestors = branching ? [...chain, node] : chain;
        const info: ContainerInfo = {
          id,
          kind: node.kind,
          parent,
          node: branching ? node : undefined,
          ancestors,
          branches: [],
          root: "/",
        };
        containers.set(id, info);
        containers.get(parent)?.branches.push(id);
        walk(
          node.children,
          base,
          ancestors,
          [...placement, id],
          branching ? info : undefined,
        );
        if (branching && info.branches.length === 0) {
          throw new Error(
            "flypath: branches() needs at least one stack() or branches() " +
              "child to branch into",
          );
        }
        continue;
      }

      const pattern = joinPattern(base, node.pattern);
      if (node.children.length === 0) {
        emit(pattern, node, node.options, chain, of());
        continue;
      }
      walk(node.children, pattern, [...chain, node], placement, shared);
    }
  };

  walk(tree.children, "", [], [ROOT_CONTAINER], undefined);

  for (const info of [...containers.values()].reverse()) {
    if (info.kind !== "branches") continue;
    const first = info.branches[0];
    const branch = first === undefined ? undefined : containers.get(first);
    if (branch) info.root = branch.root;
  }

  return { routes, containers };
}

export function hasChrome(
  containers: ReadonlyMap<string, ContainerInfo>,
  info: ContainerInfo,
): boolean {
  const parent =
    info.parent === undefined ? undefined : containers.get(info.parent);
  return info.ancestors.length > (parent?.ancestors.length ?? 0);
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
