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

const DEV = process.env["NODE_ENV"] !== "production";
const DYNAMIC_LIMIT = 256;
const minted = new Set<string>();
let warned = false;

function track(rules: AtomicRule[]): void {
  for (const rule of rules) minted.add(rule.className);
  if (warned || minted.size <= DYNAMIC_LIMIT) return;
  warned = true;
  console.warn(
    `flypath: ${minted.size} atomic classes have been generated at runtime. ` +
      "Conditional style values that change every render mint a new class each " +
      "time and their rules are never removed. Hoist the condition map or move " +
      "the changing part to a plain (unconditional) style value.",
  );
}

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

  if (DEV) track(rules);
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
