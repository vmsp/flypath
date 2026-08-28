import { matchPattern } from "./path.ts";
import type { Params, RouteOptions } from "./types.ts";

export type ManifestRoute = {
  id: string;
  pattern: string;
  options: RouteOptions;
  boundary: string;
  tab?: string;
};

export type ManifestTab = {
  key: string;
  path: string;
  title?: string;
};

export type ManifestBoundary = {
  id: string;
  tabs: ManifestTab[];
};

export type RouteManifest = {
  routes: ManifestRoute[];
  boundaries: ManifestBoundary[];
  navigator: string;
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

export function boundaryOf(
  manifest: RouteManifest,
  id: string,
): ManifestBoundary | undefined {
  return manifest.boundaries.find((boundary) => boundary.id === id);
}
