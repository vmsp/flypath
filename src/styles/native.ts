import type { Predicate } from "./conditions.ts";
import { parseCondition } from "./conditions.ts";
import { FLEX_DEFAULTS } from "./defaults.ts";
import { flattenStyle, isClassRef } from "./flatten.ts";
import { isNativeProperty, TEXT_PROPERTIES } from "./properties.ts";
import type { Frames } from "./registry.ts";
import { lookupKeyframes, lookupVar } from "./registry.ts";
import type { Scalar } from "./shorthands.ts";

export type Descriptor =
  | Scalar
  | { $var: string; d?: Descriptor }
  | { $rem: number }
  | { $em: number }
  | { $cond: { d?: Descriptor; c: [Predicate, Descriptor][] } };

export type FrameDescriptor = {
  at: number;
  style: Record<string, Descriptor>;
};

export type Animation = {
  frames: FrameDescriptor[];
  duration: number;
  delay: number;
  easing: string;
  iterations: number;
  direction: string;
  fill: string;
};

export type NativeStyle = {
  flex: boolean;
  view: Record<string, Descriptor>;
  text: Record<string, Descriptor>;
  theme: Record<string, Descriptor>;
  animation: Animation | undefined;
};

const VAR = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*?)\s*)?\)$/;
const NUMERIC = /^-?[\d.]+$/;

function parseVar(name: string, fallback: string | undefined): Descriptor {
  const registered = lookupVar(name);
  if (registered !== undefined && typeof registered === "object") {
    return { $var: name, d: parseConditions("", registered) };
  }
  if (fallback === undefined || fallback === "") return { $var: name };
  return { $var: name, d: parseValue("", fallback) };
}

export function parseValue(property: string, value: Scalar): Descriptor {
  if (typeof value === "number") {
    if (property === "lineHeight") return { $em: value };
    if (property === "fontWeight") return String(value);
    return value;
  }

  const raw = value.trim();
  const variable = VAR.exec(raw);
  if (variable) return parseVar(variable[1] ?? "", variable[2]);

  if (raw.endsWith("px") && NUMERIC.test(raw.slice(0, -2))) {
    return Number(raw.slice(0, -2));
  }
  if (raw.endsWith("rem") && NUMERIC.test(raw.slice(0, -3))) {
    return { $rem: Number(raw.slice(0, -3)) };
  }
  if (raw.endsWith("em") && NUMERIC.test(raw.slice(0, -2))) {
    return { $em: Number(raw.slice(0, -2)) };
  }
  if (NUMERIC.test(raw)) {
    if (property === "fontWeight") return raw;
    if (property === "lineHeight") return { $em: Number(raw) };
    return Number(raw);
  }
  return raw;
}

function parseConditions(
  property: string,
  map: Record<string, Scalar>,
): Descriptor {
  const conditions: [Predicate, Descriptor][] = [];
  let fallback: Descriptor | undefined;
  for (const [condition, value] of Object.entries(map)) {
    if (condition === "default") {
      fallback = parseValue(property, value);
      continue;
    }
    conditions.push([parseCondition(condition), parseValue(property, value)]);
  }
  return { $cond: { d: fallback, c: conditions } };
}

function frameOffset(key: string): number {
  if (key === "from") return 0;
  if (key === "to") return 1;
  return Number(key.replace("%", "")) / 100;
}

function parseFrames(frames: Frames): FrameDescriptor[] {
  return Object.entries(frames)
    .map(([offset, style]) => {
      const parsed: Record<string, Descriptor> = {};
      for (const [property, value] of Object.entries(style)) {
        if (!isNativeProperty(property)) continue;
        parsed[property] = parseValue(property, value);
      }
      return { at: frameOffset(offset), style: parsed };
    })
    .sort((a, b) => a.at - b.at);
}

function time(value: Scalar | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  if (value.endsWith("ms")) return Number(value.slice(0, -2));
  if (value.endsWith("s")) return Number(value.slice(0, -1)) * 1000;
  return Number(value) || fallback;
}

function iterationCount(value: Scalar | undefined): number {
  if (value === undefined) return 1;
  if (value === "infinite") return Infinity;
  return Number(value);
}

function buildAnimation(props: Map<string, Scalar>): Animation | undefined {
  const name = props.get("animationName");
  if (name === undefined) return undefined;
  const frames = lookupKeyframes(String(name));
  if (!frames) {
    throw new Error(`flypath: unknown animation name "${String(name)}"`);
  }
  return {
    frames: parseFrames(frames),
    duration: time(props.get("animationDuration"), 0),
    delay: time(props.get("animationDelay"), 0),
    easing: String(props.get("animationTimingFunction") ?? "ease"),
    iterations: iterationCount(props.get("animationIterationCount")),
    direction: String(props.get("animationDirection") ?? "normal"),
    fill: String(props.get("animationFillMode") ?? "none"),
  };
}

export function normalizeNativeStyle(
  tag: string,
  input: unknown,
  dev: boolean,
): NativeStyle {
  const { props, theme } = flattenStyle(input);

  const animationProps = new Map<string, Scalar>();
  for (const key of [...props.keys()]) {
    if (!key.startsWith("animation")) continue;
    const value = props.get(key);
    if (typeof value === "object") {
      throw new Error(
        `flypath: <${tag}> animation properties do not support conditions`,
      );
    }
    animationProps.set(key, value as Scalar);
    props.delete(key);
  }

  const flex = props.get("display") === "flex";
  if (flex) {
    props.delete("display");
    for (const [key, value] of Object.entries(FLEX_DEFAULTS)) {
      if (!props.has(key)) props.set(key, value);
    }
  }

  const view: Record<string, Descriptor> = {};
  const text: Record<string, Descriptor> = {};

  for (const [property, value] of props) {
    if (!isNativeProperty(property)) {
      if (dev) {
        throw new Error(
          `flypath: <${tag}> style property "${property}" has no native equivalent`,
        );
      }
      continue;
    }
    const descriptor = isClassRef(value)
      ? parseConditions(property, value.map)
      : typeof value === "object"
        ? parseConditions(property, value)
        : parseValue(property, value as Scalar);
    if (TEXT_PROPERTIES.has(property)) text[property] = descriptor;
    else view[property] = descriptor;
  }

  const themeDescriptors: Record<string, Descriptor> = {};
  for (const [name, value] of Object.entries(theme)) {
    themeDescriptors[name] = parseValue("", value);
  }

  return {
    flex,
    view,
    text,
    theme: themeDescriptors,
    animation: buildAnimation(animationProps),
  };
}

const identity = new WeakMap<object, NativeStyle>();
const structural = new Map<string, NativeStyle>();
const LIMIT = 512;

export function nativeStyle(
  tag: string,
  input: unknown,
  dev: boolean,
): NativeStyle | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const cached = identity.get(input as object);
  if (cached) return cached;

  const key = `${tag} ${JSON.stringify(input)}`;
  const hit = structural.get(key);
  if (hit) {
    identity.set(input as object, hit);
    return hit;
  }

  const result = normalizeNativeStyle(tag, input, dev);
  identity.set(input as object, result);
  if (structural.size >= LIMIT) {
    const oldest = structural.keys().next().value;
    if (oldest !== undefined) structural.delete(oldest);
  }
  structural.set(key, result);
  return result;
}
