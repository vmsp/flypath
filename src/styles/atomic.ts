import { isMedia, isPseudo } from "./conditions.ts";
import { hash } from "./hash.ts";
import { hyphenate } from "./properties.ts";
import { cssValue } from "./serialize.ts";
import type { Scalar } from "./shorthands.ts";

export type AtomicRule = {
  className: string;
  css: string;
};

export function atomicClassName(
  property: string,
  map: Record<string, Scalar>,
): string {
  const key = `${property}|${Object.entries(map)
    .map(([k, v]) => `${k}:${String(v)}`)
    .join("|")}`;
  return `fp-${hash(key)}`;
}

export function atomicRule(
  property: string,
  map: Record<string, Scalar>,
): AtomicRule {
  const className = atomicClassName(property, map);
  const declaration = (value: Scalar) =>
    `${hyphenate(property)}: ${cssValue(property, value)};`;

  const parts: string[] = [];
  for (const [condition, value] of Object.entries(map)) {
    if (condition === "default") {
      parts.push(`.${className} { ${declaration(value)} }`);
    } else if (isPseudo(condition)) {
      parts.push(`.${className}${condition} { ${declaration(value)} }`);
    } else if (isMedia(condition)) {
      parts.push(`${condition} { .${className} { ${declaration(value)} } }`);
    } else {
      throw new Error(
        `flypath: unsupported condition "${condition}" on "${property}"`,
      );
    }
  }
  return { className, css: parts.join("\n") };
}
