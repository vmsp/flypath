import type { AtomicRule } from "./atomic.ts";
import { atomicRule } from "./atomic.ts";
import type { ConditionValues, FlatValue } from "./flatten.ts";
import { flattenStyle, isClassRef } from "./flatten.ts";
import type { Scalar } from "./shorthands.ts";

export type WebStyle = {
  style: Record<string, Scalar> | undefined;
  classes: string[];
  rules: AtomicRule[];
};

const cache = new WeakMap<object, WebStyle>();

function build(input: unknown): WebStyle {
  const { props, theme } = flattenStyle(input);
  const style: Record<string, Scalar> = { ...theme };
  const classes: string[] = [];
  const rules: AtomicRule[] = [];
  let hasInline = Object.keys(theme).length > 0;

  for (const [property, value] of props) {
    if (isClassRef(value)) {
      classes.push(value.$class);
      continue;
    }
    if (typeof value === "object") {
      const rule = atomicRule(property, value as ConditionValues);
      classes.push(rule.className);
      rules.push(rule);
      continue;
    }
    style[property] = value as Scalar;
    hasInline = true;
  }

  return { style: hasInline ? style : undefined, classes, rules };
}

export function webStyle(input: unknown): WebStyle {
  if (input === null || typeof input !== "object") {
    return { style: undefined, classes: [], rules: [] };
  }
  const cached = cache.get(input as object);
  if (cached) return cached;
  const result = build(input);
  cache.set(input as object, result);
  return result;
}

export type { FlatValue };
