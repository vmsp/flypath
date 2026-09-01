"use client";

import type { Context, ReactNode } from "react";
import { createContext, use, useContext, useMemo } from "react";
import { manifest } from "virtual:flypath/route-manifest";

import type { ContainerKind, ManifestContainer } from "./manifest.ts";
import {
  containerById,
  matchManifest,
  ROOT_CONTAINER,
  SHARED,
} from "./manifest.ts";
import { normalizePath } from "./path.ts";
import { makeParams, makeQuery } from "./read.ts";
import type { Href, ParamsReader, QueryReader, RouteInfo } from "./types.ts";

export type Branch = {
  key: string;
  href: Href;
  active: boolean;
};

export type ContainerRuntime = {
  activeBranch: (id: string) => string | undefined;
};

const ContainerScopeContext: Context<string | null> = createContext<
  string | null
>(null);

const RouteScopeContext: Context<RouteInfo | null> =
  createContext<RouteInfo | null>(null);

export const ContainerRuntimeContext: Context<ContainerRuntime | null> =
  createContext<ContainerRuntime | null>(null);

export function ContainerScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): ReactNode {
  return (
    <ContainerScopeContext.Provider value={id}>
      {children}
    </ContainerScopeContext.Provider>
  );
}

export function RouteScope({
  value,
  children,
}: {
  value: RouteInfo;
  children: ReactNode;
}): ReactNode {
  return (
    <RouteScopeContext.Provider value={value}>
      {children}
    </RouteScopeContext.Provider>
  );
}

function scope(): RouteInfo {
  const value = use(RouteScopeContext);
  if (!value) {
    throw new Error(
      "flypath: params() and query() read the route that rendered the " +
        "component, so they only work while a component rendered by the " +
        "flypath router is rendering",
    );
  }
  return value;
}

export const params: ParamsReader = makeParams(scope);

export const query: QueryReader = makeQuery(scope);

function enclosing(
  scopeId: string | null,
  kind: ContainerKind,
): ManifestContainer | undefined {
  let current: string | undefined = scopeId ?? ROOT_CONTAINER;
  while (current !== undefined) {
    const info = containerById(manifest, current);
    if (!info) return undefined;
    if (info.kind === kind) return info;
    current = info.parent;
  }
  return undefined;
}

function declaredBranch(
  pathname: string,
  container: string,
): string | undefined {
  const placement = matchManifest(manifest, pathname)?.placement;
  const position = placement?.indexOf(container) ?? -1;
  if (!placement || position === -1) return undefined;
  const branch = placement[position + 1];
  return branch === SHARED ? undefined : branch;
}

export function useBranches(): readonly Branch[] {
  const scopeId = useContext(ContainerScopeContext);
  const runtime = useContext(ContainerRuntimeContext);
  const { pathname } = scope();
  const container = enclosing(scopeId, "branches");
  const active = container ? runtime?.activeBranch(container.id) : undefined;

  return useMemo(() => {
    if (!container) return [];
    const current =
      active ??
      declaredBranch(normalizePath(pathname), container.id) ??
      container.branches[0];
    return container.branches.map((id) => ({
      key: id,
      href: (containerById(manifest, id)?.root ?? "/") as Href,
      active: id === current,
    }));
  }, [container, active, pathname]);
}
