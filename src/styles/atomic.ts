import { isMedia, isPseudo } from "./conditions.ts";
import { hash } from "./hash.ts";
import { hyphenate } from "./properties.ts";
import { cssValue } from "./serialize.ts";
import type { Scalar } from "./shorthands.ts";

export type AtomicRule = {
  className: string;
  css: string;
};

export type RuleOptions = {
  important?: boolean;
  skipDefault?: boolean;
  variant?: string;
};

function atomicClassName(
  property: string,
  map: Record<string, Scalar>,
  variant: string,
): string {
  const key = `${variant}${property}|${Object.entries(map)
    .map(([k, v]) => `${k}:${String(v)}`)
    .join("|")}`;
  return `fp-${hash(key)}`;
}

export function atomicRule(
  property: string,
  map: Record<string, Scalar>,
  options: RuleOptions = {},
): AtomicRule {
  const { important = false, skipDefault = false, variant = "" } = options;
  const className = atomicClassName(property, map, variant);
  const priority = important ? " !important" : "";
  const declaration = (value: Scalar) =>
    `${hyphenate(property)}: ${cssValue(property, value)}${priority};`;

  const parts: string[] = [];
  for (const [condition, value] of Object.entries(map)) {
    if (condition === "default") {
      if (skipDefault) continue;
      parts.push(`.${className} { ${declaration(value)} }`);
    } else if (isPseudo(condition)) {
      parts.push(`.${className}${condition} { ${declaration(value)} }`);
    } else if (isMedia(condition)) {
      parts.push(`${condition} { .${className} { ${declaration(value)} } }`);
    } else {
      throw new Error(`Unsupported condition "${condition}" on "${property}"`);
    }
  }
  return { className, css: parts.join("\n") };
}
