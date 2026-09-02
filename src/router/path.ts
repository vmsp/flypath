import { isInternalParam } from "../protocol/params.ts";
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

export function matchPattern(
  pattern: string,
  pathname: string,
): Params | undefined {
  const expected = segments(pattern);
  const actual = segments(pathname);
  const params: Params = {};

  for (const [position, part] of expected.entries()) {
    const value = actual[position];
    if (value === undefined) return undefined;
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (part !== value) return undefined;
  }

  return expected.length === actual.length ? params : undefined;
}

export function hrefOf(url: URL): string {
  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (isInternalParam(key)) continue;
    params.append(key, value);
  }
  const query = params.toString();
  return `${normalizePath(url.pathname)}${query === "" ? "" : `?${query}`}`;
}

export function searchOf(url: URL): Search {
  const out: Record<string, readonly string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (isInternalParam(key)) continue;
    out[key] = url.searchParams.getAll(key);
  }
  return out;
}
