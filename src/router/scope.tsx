"use client";

import type { Context, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { manifest } from "virtual:flypath/route-manifest";

import { usePathname } from "./client.ts";
import type { ContainerKind, ManifestContainer } from "./manifest.ts";
import {
  containerById,
  matchManifest,
  ROOT_CONTAINER,
  SHARED,
} from "./manifest.ts";
import { normalizePath } from "./path.ts";
import type { Href } from "./types.ts";

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

function enclosing(
  scope: string | null,
  kind: ContainerKind,
): ManifestContainer | undefined {
  let current: string | undefined = scope ?? ROOT_CONTAINER;
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
  const placement = matchManifest(manifest, pathname)?.route.placement;
  const position = placement?.indexOf(container) ?? -1;
  if (!placement || position === -1) return undefined;
  const branch = placement[position + 1];
  return branch === SHARED ? undefined : branch;
}

export function useBranches(): readonly Branch[] {
  const scope = useContext(ContainerScopeContext);
  const runtime = useContext(ContainerRuntimeContext);
  const pathname = usePathname();
  const container = enclosing(scope, "branches");
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
