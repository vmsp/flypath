import { matchPattern } from "./path.ts";
import type { Params, RouteOptions } from "./types.ts";

export const ROOT_CONTAINER = "root";

export const SHARED = "*";

export type ContainerKind = "stack" | "branches";

export type ManifestContainer = {
  id: string;
  kind: ContainerKind;
  parent?: string;
  branches: string[];
  root: string;
  chrome: boolean;
};

export type ManifestRoute = {
  id: string;
  pattern: string;
  options: RouteOptions;
  placement: string[];
};

export type RouteManifest = {
  routes: ManifestRoute[];
  containers: ManifestContainer[];
};

export type RouteMatch = {
  route: ManifestRoute;
  params: Params;
};

export function matchManifest(
  manifest: RouteManifest,
  pathname: string,
): RouteMatch | undefined {
  for (const route of manifest.routes) {
    const params = matchPattern(route.pattern, pathname);
    if (params) return { route, params };
  }
  return undefined;
}

export function containerById(
  manifest: RouteManifest,
  id: string,
): ManifestContainer | undefined {
  return manifest.containers.find((container) => container.id === id);
}

export function declaredContainer(placement: readonly string[]): string {
  const last = placement.at(-1);
  if (last !== SHARED) return last ?? ROOT_CONTAINER;
  return placement.at(-2) ?? ROOT_CONTAINER;
}
