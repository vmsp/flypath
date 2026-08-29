import { isConditionMap, validateConditionMap } from "./conditions.ts";
import { isSupported } from "./properties.ts";
import type { Scalar } from "./shorthands.ts";
import { expandConditionMap, expandProperty } from "./shorthands.ts";

export type ClassRef = { $class: string; map: ConditionValues };
export type ConditionValues = Record<string, Scalar>;
export type FlatValue = Scalar | ClassRef | ConditionValues;

export type Flattened = {
  props: Map<string, FlatValue>;
  theme: Record<string, Scalar>;
};

export function isClassRef(value: unknown): value is ClassRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "$class" in (value as Record<string, unknown>)
  );
}

const SCROLLABLE: ReadonlySet<Scalar> = new Set(["auto", "scroll"]);

export function conditionValues(
  value: FlatValue | undefined,
): ConditionValues | undefined {
  if (value === null || value === undefined || typeof value !== "object") {
    return undefined;
  }
  return isClassRef(value) ? value.map : value;
}

export function isScrollValue(value: FlatValue | undefined): boolean {
  if (value === undefined) return false;
  const map = conditionValues(value);
  if (!map) return SCROLLABLE.has(value as Scalar);
  return Object.values(map).some((entry) => SCROLLABLE.has(entry));
}

function visit(input: unknown, out: Flattened): void {
  if (input === null || input === undefined || input === false) return;
  if (Array.isArray(input)) {
    for (const item of input) visit(item, out);
    return;
  }
  if (typeof input !== "object") return;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (key.startsWith("--")) {
      out.theme[key] = value as Scalar;
      continue;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      "$c" in (value as Record<string, unknown>)
    ) {
      const marker = value as {
        $c: Record<string, string>;
        $v: ConditionValues;
      };
      for (const [longhand, map] of expandConditionMap(key, marker.$v)) {
        out.props.set(longhand, {
          $class: marker.$c[longhand] as string,
          map,
        });
      }
      continue;
    }
    if (!isSupported(key)) {
      throw new Error(`flypath: unsupported style property "${key}"`);
    }
    if (isConditionMap(value)) {
      validateConditionMap(key, value);
      const expanded = expandConditionMap(key, value as ConditionValues);
      for (const [longhand, map] of expanded) out.props.set(longhand, map);
      continue;
    }
    for (const [longhand, scalar] of expandProperty(key, value as Scalar)) {
      out.props.set(longhand, scalar);
    }
  }
}

export function flattenStyle(input: unknown): Flattened {
  const out: Flattened = { props: new Map(), theme: {} };
  visit(input, out);
  return out;
}
