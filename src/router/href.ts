import type { Href, HrefArgs, Pattern } from "./types.ts";

function encode(value: string | readonly string[]): string {
  return Array.isArray(value)
    ? (value as readonly string[]).map(encodeURIComponent).join("/")
    : encodeURIComponent(value as string);
}

export function href<const P extends Pattern>(
  pattern: P,
  ...args: HrefArgs<P>
): Href {
  const params = args[0] as Record<string, string | readonly string[]>;
  const parts: string[] = [];

  for (const part of (pattern as string).split("/")) {
    if (part === "") continue;
    if (part === "*") {
      const value = params?.["*"];
      if (value !== undefined && value !== "") parts.push(encode(value));
      continue;
    }
    if (part.startsWith(":")) {
      const name = part.slice(1);
      const value = params?.[name];
      if (value === undefined) {
        throw new Error(`flypath: href("${pattern}") is missing "${name}"`);
      }
      parts.push(encode(value));
      continue;
    }
    parts.push(part);
  }

  return (parts.length === 0 ? "/" : `/${parts.join("/")}`) as Href;
}
