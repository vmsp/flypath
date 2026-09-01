import { matchPattern } from "./path.ts";
import type { RouteOptions } from "./types.ts";

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
  fallback?: ManifestRoute;
  containers: ManifestContainer[];
};

export function matchManifest(
  manifest: RouteManifest,
  pathname: string,
): ManifestRoute | undefined {
  for (const route of manifest.routes) {
    if (matchPattern(route.pattern, pathname)) return route;
  }
  return manifest.fallback;
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
