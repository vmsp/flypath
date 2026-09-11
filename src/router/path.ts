import type { Params, Search } from "./types.ts";

export function normalizePath(pathname: string): string {
  const value = pathname.split("?")[0]?.split("#")[0] ?? "";
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  const trimmed = prefixed.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function segments(pattern: string): string[] {
  return normalizePath(pattern)
    .split("/")
    .filter((part) => part !== "");
}

export function joinPattern(base: string, pattern: string): string {
  const parts = [...segments(base), ...segments(pattern)];
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

const patterns = new WeakMap<readonly { pattern: string }[], string[][]>();

export function matchRoutes<T extends { pattern: string }>(
  routes: readonly T[],
  pathname: string,
): { route: T; params: Params } | undefined {
  let compiled = patterns.get(routes);
  if (!compiled) {
    compiled = routes.map((route) => segments(route.pattern));
    patterns.set(routes, compiled);
  }
  const actual = segments(pathname);
  for (const [index, expected] of compiled.entries()) {
    if (expected.length !== actual.length) continue;
    if (
      !expected.every((part, at) => part.startsWith(":") || part === actual[at])
    ) {
      continue;
    }
    const params: Params = {};
    for (const [at, part] of expected.entries()) {
      if (part.startsWith(":"))
        params[part.slice(1)] = decodeURIComponent(actual[at]!);
    }
    return { route: routes[index]!, params };
  }
  return undefined;
}

export function hrefOf(url: URL): string {
  const query = url.searchParams.toString();
  return `${normalizePath(url.pathname)}${query === "" ? "" : `?${query}`}`;
}

export function searchOf(url: URL): Search {
  const out: Record<string, readonly string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    out[key] = url.searchParams.getAll(key);
  }
  return out;
}
