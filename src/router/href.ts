import type { Href, HrefArgs, Pattern } from "./types.ts";

export function href<const P extends Pattern>(
  pattern: P,
  ...args: HrefArgs<P>
): Href {
  const params = args[0] as Record<string, string>;
  const parts: string[] = [];

  for (const part of (pattern as string).split("/")) {
    if (part === "") continue;
    if (part.startsWith(":")) {
      const name = part.slice(1);
      const value = params?.[name];
      if (value === undefined) {
        throw new Error(`flypath: href("${pattern}") is missing "${name}"`);
      }
      parts.push(encodeURIComponent(value));
      continue;
    }
    parts.push(part);
  }

  return (parts.length === 0 ? "/" : `/${parts.join("/")}`) as Href;
}
