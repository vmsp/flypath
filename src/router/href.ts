import type { Href, HrefArgs, Pattern } from "./types.ts";

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i;

export function isExternal(to: string): boolean {
  return ABSOLUTE.test(to) || to.startsWith("#") || to.startsWith("//");
}

export function buildHref(
  pattern: string,
  params: Readonly<Record<string, unknown>> | undefined,
): string {
  const used = new Set<string>();
  const parts: string[] = [];

  for (const part of pattern.split("/")) {
    if (part === "") continue;
    if (part.startsWith(":")) {
      const name = part.slice(1);
      const value = params?.[name];
      if (value === undefined || value === null) {
        throw new Error(`flypath: href("${pattern}") is missing "${name}"`);
      }
      used.add(name);
      parts.push(encodeURIComponent(String(value)));
      continue;
    }
    parts.push(part);
  }

  const path = parts.length === 0 ? "/" : `/${parts.join("/")}`;
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (used.has(key) || value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (item === undefined || item === null) continue;
      search.append(key, String(item));
    }
  }

  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

export function href<const P extends Pattern>(
  pattern: P,
  ...args: HrefArgs<P>
): Href {
  return buildHref(
    pattern as string,
    args[0] as Readonly<Record<string, unknown>> | undefined,
  ) as Href;
}
