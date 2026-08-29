import { isShorthand } from "./properties.ts";

export type Scalar = string | number;
export type Entry = [string, Scalar];

export function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== "") parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") parts.push(current);
  return parts;
}

function sides(value: Scalar): [Scalar, Scalar, Scalar, Scalar] {
  if (typeof value === "number") return [value, value, value, value];
  const parts = splitTop(value) as Scalar[];
  const top = parts[0] ?? 0;
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}

const TIME = /^-?[\d.]+m?s$/;
const EASING = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);
const DIRECTION = new Set([
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
]);
const FILL = new Set(["none", "forwards", "backwards", "both"]);
const BORDER_STYLE = new Set([
  "none",
  "hidden",
  "solid",
  "dotted",
  "dashed",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

function animation(value: Scalar): Entry[] {
  const tokens = splitTop(String(value));
  const out: Entry[] = [];
  let times = 0;
  let name: string | undefined;
  for (const token of tokens) {
    if (TIME.test(token)) {
      out.push([times === 0 ? "animationDuration" : "animationDelay", token]);
      times += 1;
      continue;
    }
    if (token === "infinite") {
      out.push(["animationIterationCount", "infinite"]);
      continue;
    }
    if (/^[\d.]+$/.test(token)) {
      out.push(["animationIterationCount", Number(token)]);
      continue;
    }
    if (
      EASING.has(token) ||
      token.startsWith("cubic-bezier(") ||
      token.startsWith("steps(")
    ) {
      out.push(["animationTimingFunction", token]);
      continue;
    }
    if (DIRECTION.has(token) && name !== undefined) {
      out.push(["animationDirection", token]);
      continue;
    }
    if (FILL.has(token) && name !== undefined) {
      out.push(["animationFillMode", token]);
      continue;
    }
    name ??= token;
  }
  if (name !== undefined) out.push(["animationName", name]);
  return out;
}

function border(value: Scalar): Entry[] {
  const out: Entry[] = [];
  const push = (suffix: string, next: Scalar) => {
    out.push(
      [`borderTop${suffix}`, next],
      [`borderRight${suffix}`, next],
      [`borderBottom${suffix}`, next],
      [`borderLeft${suffix}`, next],
    );
  };
  if (typeof value === "number") {
    push("Width", value);
    return out;
  }
  for (const token of splitTop(value)) {
    if (BORDER_STYLE.has(token)) push("Style", token);
    else if (/^[\d.]/.test(token)) push("Width", token);
    else push("Color", token);
  }
  return out;
}

function flex(value: Scalar): Entry[] {
  if (typeof value === "number" || /^[\d.]+$/.test(value)) {
    return [
      ["flexGrow", Number(value)],
      ["flexShrink", 1],
      ["flexBasis", "0%"],
    ];
  }
  if (value === "none") {
    return [
      ["flexGrow", 0],
      ["flexShrink", 0],
      ["flexBasis", "auto"],
    ];
  }
  if (value === "auto") {
    return [
      ["flexGrow", 1],
      ["flexShrink", 1],
      ["flexBasis", "auto"],
    ];
  }
  const parts = splitTop(value);
  const out: Entry[] = [];
  const grow = parts[0];
  if (grow !== undefined) out.push(["flexGrow", Number(grow)]);
  const second = parts[1];
  if (second !== undefined) {
    if (/^[\d.]+$/.test(second)) out.push(["flexShrink", Number(second)]);
    else out.push(["flexBasis", second]);
  }
  const third = parts[2];
  if (third !== undefined) out.push(["flexBasis", third]);
  return out;
}

export function expandProperty(name: string, value: Scalar): Entry[] {
  if (!isShorthand(name)) return [[name, value]];

  switch (name) {
    case "animation":
      return animation(value);
    case "border":
      return border(value);
    case "flex":
      return flex(value);
    case "gap": {
      const parts =
        typeof value === "number"
          ? [value, value]
          : (splitTop(value) as Scalar[]);
      const row = parts[0] ?? 0;
      return [
        ["rowGap", row],
        ["columnGap", parts[1] ?? row],
      ];
    }
    case "borderRadius": {
      const [tl, tr, br, bl] = sides(value);
      return [
        ["borderTopLeftRadius", tl],
        ["borderTopRightRadius", tr],
        ["borderBottomRightRadius", br],
        ["borderBottomLeftRadius", bl],
      ];
    }
    case "borderColor":
    case "borderStyle":
    case "borderWidth": {
      const suffix = name.slice("border".length);
      const [top, right, bottom, left] = sides(value);
      return [
        [`borderTop${suffix}`, top],
        [`borderRight${suffix}`, right],
        [`borderBottom${suffix}`, bottom],
        [`borderLeft${suffix}`, left],
      ];
    }
    case "inset": {
      const [top, right, bottom, left] = sides(value);
      return [
        ["top", top],
        ["right", right],
        ["bottom", bottom],
        ["left", left],
      ];
    }
    case "overflow":
      return [
        ["overflowX", value],
        ["overflowY", value],
      ];
    default: {
      const prefix = name === "margin" ? "margin" : "padding";
      const [top, right, bottom, left] = sides(value);
      return [
        [`${prefix}Top`, top],
        [`${prefix}Right`, right],
        [`${prefix}Bottom`, bottom],
        [`${prefix}Left`, left],
      ];
    }
  }
}

export function expandConditionMap(
  name: string,
  map: Record<string, Scalar>,
): Map<string, Record<string, Scalar>> {
  const out = new Map<string, Record<string, Scalar>>();
  for (const [condition, value] of Object.entries(map)) {
    for (const [longhand, expanded] of expandProperty(name, value)) {
      let target = out.get(longhand);
      if (!target) {
        target = {};
        out.set(longhand, target);
      }
      target[condition] = expanded;
    }
  }
  return out;
}
