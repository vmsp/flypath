import type { AtomicRule } from "./atomic.ts";
import { atomicRule } from "./atomic.ts";
import { TAG_DEFAULTS } from "./defaults.ts";
import type { ConditionValues } from "./flatten.ts";
import { flattenStyle, isClassRef } from "./flatten.ts";
import { lookupVar } from "./registry.ts";
import type { Scalar } from "./shorthands.ts";

export type EmailStyle = {
  style: Record<string, Scalar> | undefined;
  classes: string[];
  rules: AtomicRule[];
};

const DEV = process.env.NODE_ENV !== "production";

/**
 * Styles reset for emails.
 *
 * Constrained version of the web one, found in {@link ./defaults.ts}. They must
 * be kept in sync.
 */
export const EMAIL_RESET: string = [
  "* { box-sizing: border-box; margin: 0; min-height: 0; min-width: 0; }",
  "html { font-family: system-ui, sans-serif; }",
  ":root { color-scheme: light dark; supported-color-schemes: light dark; }",
  "body { line-height: 1.5; -webkit-font-smoothing: antialiased; }",
  "img, picture, video, canvas, svg { display: block; max-width: 100%; }",
  "img { border: 0; outline: none; -ms-interpolation-mode: bicubic; }",
  "table { border-collapse: collapse; }",
  "a { text-decoration: none; }",
  "input, button, textarea, select { font: inherit; }",
  "p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }",
  "p { text-wrap: pretty; }",
  "h1, h2, h3, h4, h5, h6 { text-wrap: balance; }",
].join("\n");

const MARGINED: ReadonlySet<string> = new Set([
  "blockquote",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
]);

function emailDefaults(): Record<string, Record<string, Scalar>> {
  const out: Record<string, Record<string, Scalar>> = {};
  for (const [tag, defaults] of Object.entries(TAG_DEFAULTS)) {
    const style: Record<string, Scalar> = { ...defaults.style };
    const size = style["fontSize"];
    const height = style["lineHeight"];
    if (typeof height === "number" && typeof size === "number") {
      style["lineHeight"] = height / size;
    }
    if (MARGINED.has(tag)) style["margin"] = 0;
    out[tag] = style;
  }
  return out;
}

export const EMAIL_DEFAULTS: Record<
  string,
  Record<string, Scalar>
> = emailDefaults();

const IGNORED: ReadonlySet<string> = new Set([
  "cursor",
  "overflowX",
  "overflowY",
  "pointerEvents",
  "position",
  "transform",
  "transformOrigin",
  "userSelect",
  "zIndex",
]);

const VAR = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*?)\s*)?\)$/;

const DEPTH = 8;

function unknownVar(tag: string, property: string, name: string): never {
  throw new Error(
    `flypath: <${tag}> style "${property}" reads the css variable "${name}", ` +
      "which no *.css.ts module registered and which carries no fallback. " +
      "An inbox cannot resolve var(), so email needs a literal value",
  );
}

function resolveScalar(
  tag: string,
  property: string,
  value: Scalar,
  depth: number,
): Scalar | ConditionValues {
  if (typeof value !== "string" || depth === 0) return value;
  const match = VAR.exec(value.trim());
  if (!match) return value;

  const name = match[1] as string;
  const registered = lookupVar(name);
  if (registered === undefined) {
    const fallback = match[2];
    if (fallback === undefined || fallback === "") {
      unknownVar(tag, property, name);
    }
    return resolveScalar(tag, property, fallback, depth - 1);
  }
  if (typeof registered !== "object") {
    return resolveScalar(tag, property, registered, depth - 1);
  }

  const out: ConditionValues = {};
  for (const [condition, entry] of Object.entries(registered)) {
    const resolved = resolveScalar(tag, property, entry, depth - 1);
    out[condition] =
      typeof resolved === "object"
        ? ((resolved["default"] ?? entry) as Scalar)
        : resolved;
  }
  return out;
}

function resolveMap(
  tag: string,
  property: string,
  map: ConditionValues,
): ConditionValues {
  const out: ConditionValues = {};
  const spread: ConditionValues = {};
  for (const [condition, value] of Object.entries(map)) {
    const resolved = resolveScalar(tag, property, value, DEPTH);
    if (typeof resolved !== "object") {
      out[condition] = resolved;
      continue;
    }
    if (condition !== "default") {
      out[condition] = (resolved["default"] ??
        Object.values(resolved)[0]) as Scalar;
      continue;
    }
    for (const [nested, entry] of Object.entries(resolved))
      spread[nested] = entry;
  }
  return { ...spread, ...out };
}

function warnIgnored(tag: string, property: string): void {
  console.warn(
    `flypath: <${tag}> style "${property}" is not honoured by any email ` +
      "client; it is sent anyway, but the message should not depend on it",
  );
}

function build(tag: string, input: unknown): EmailStyle {
  const defaults = EMAIL_DEFAULTS[tag];
  const { props, theme } = flattenStyle(
    defaults === undefined ? input : [defaults, input],
  );

  const themed = Object.keys(theme);
  if (themed.length > 0) {
    throw new Error(
      `flypath: <${tag}> carries the css.override() theme "${
        themed[0] as string
      }", which reaches descendants through the cascade. Email inlines every ` +
        "declaration on the element it belongs to, so a theme cannot travel; " +
        "pass the value down as a prop instead",
    );
  }

  const style: Record<string, Scalar> = {};
  const classes: string[] = [];
  const rules: AtomicRule[] = [];

  const emit = (property: string, map: ConditionValues): void => {
    const fallback = map["default"];
    if (fallback !== undefined) style[property] = fallback;
    const conditional = Object.keys(map).some((key) => key !== "default");
    if (!conditional) return;
    const rule = atomicRule(property, map, {
      important: true,
      skipDefault: true,
      variant: "email",
    });
    classes.push(rule.className);
    rules.push(rule);
  };

  for (const [property, value] of props) {
    if (property === "animationName") {
      throw new Error(
        `flypath: <${tag}> is animated, but the @keyframes it names lives in ` +
          "the app stylesheet, which no inbox loads. Remove the animation " +
          "from the email, or render the end state directly",
      );
    }
    if (DEV && IGNORED.has(property)) warnIgnored(tag, property);

    if (isClassRef(value)) {
      emit(property, resolveMap(tag, property, value.map));
      continue;
    }
    if (typeof value === "object") {
      emit(property, resolveMap(tag, property, value));
      continue;
    }

    const resolved = resolveScalar(tag, property, value, DEPTH);
    if (typeof resolved === "object") {
      emit(property, resolved);
      continue;
    }
    style[property] = resolved;
  }

  return {
    style: Object.keys(style).length > 0 ? style : undefined,
    classes,
    rules,
  };
}

const bare = new Map<string, EmailStyle>();
const cache = new WeakMap<object, Map<string, EmailStyle>>();

export function emailStyle(tag: string, input: unknown): EmailStyle {
  if (input === null || typeof input !== "object") {
    const cached = bare.get(tag);
    if (cached) return cached;
    const result = build(tag, undefined);
    bare.set(tag, result);
    return result;
  }

  let byTag = cache.get(input as object);
  if (!byTag) {
    byTag = new Map();
    cache.set(input as object, byTag);
  }
  const cached = byTag.get(tag);
  if (cached) return cached;
  const result = build(tag, input);
  byTag.set(tag, result);
  return result;
}
