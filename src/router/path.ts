import type { Params } from "./types.ts";

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
    if (part === "*") {
      params["*"] = actual.slice(position).join("/");
      return params;
    }
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

export function searchParamsOf(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (key === "__flight" || key.startsWith("__flypath")) continue;
    const values = url.searchParams.getAll(key);
    out[key] = values.length === 1 ? (values[0] as string) : values;
  }
  return out;
}
