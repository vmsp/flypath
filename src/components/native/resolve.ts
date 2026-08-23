import type { Predicate } from "../../styles/conditions.ts";

export type Env = {
  width: number;
  height: number;
  scheme: "light" | "dark";
  reduceMotion: boolean;
  hover: boolean;
  active: boolean;
  focus: boolean;
  fontSize: number;
  rootFontSize: number;
  theme: Record<string, unknown>;
};

export type Style = Record<string, unknown>;

function matches(predicate: Predicate, env: Env): boolean {
  if (predicate.minWidth !== undefined && env.width < predicate.minWidth) {
    return false;
  }
  if (predicate.maxWidth !== undefined && env.width > predicate.maxWidth) {
    return false;
  }
  if (predicate.minHeight !== undefined && env.height < predicate.minHeight) {
    return false;
  }
  if (predicate.maxHeight !== undefined && env.height > predicate.maxHeight) {
    return false;
  }
  if (predicate.scheme !== undefined && env.scheme !== predicate.scheme) {
    return false;
  }
  if (predicate.motion !== undefined) {
    const wanted = predicate.motion === "reduce";
    if (env.reduceMotion !== wanted) return false;
  }
  if (predicate.hover === true && !env.hover) return false;
  if (predicate.active === true && !env.active) return false;
  if (predicate.focus === true && !env.focus) return false;
  return true;
}

function isPseudo(predicate: Predicate): boolean {
  return (
    predicate.hover === true ||
    predicate.active === true ||
    predicate.focus === true
  );
}

export function resolve(value: unknown, env: Env): unknown {
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;

  if ("$var" in record) {
    const name = String(record["$var"]);
    const themed = env.theme[name];
    if (themed !== undefined) return resolve(themed, env);
    return resolve(record["d"], env);
  }
  if ("$rem" in record) {
    return Number(record["$rem"]) * env.rootFontSize;
  }
  if ("$em" in record) {
    return Number(record["$em"]) * env.fontSize;
  }
  if ("$cond" in record) {
    const cond = record["$cond"] as {
      d?: unknown;
      c: [Predicate, unknown][];
    };
    let winner = cond.d;
    let pseudo: unknown;
    let hasPseudo = false;
    for (const [predicate, next] of cond.c) {
      if (!matches(predicate, env)) continue;
      if (isPseudo(predicate)) {
        pseudo = next;
        hasPseudo = true;
      } else {
        winner = next;
      }
    }
    return resolve(hasPseudo ? pseudo : winner, env);
  }
  return value;
}

export function resolveStyle(style: Style | undefined, env: Env): Style {
  const out: Style = {};
  if (!style) return out;
  for (const [property, value] of Object.entries(style)) {
    const resolved = resolve(value, env);
    if (resolved !== undefined) out[property] = resolved;
  }
  return out;
}

export function resolveTheme(
  theme: Style | undefined,
  env: Env,
): Record<string, unknown> | undefined {
  if (!theme) return undefined;
  const keys = Object.keys(theme);
  if (keys.length === 0) return undefined;
  const out: Record<string, unknown> = { ...env.theme };
  for (const key of keys) out[key] = resolve(theme[key], env);
  return out;
}
