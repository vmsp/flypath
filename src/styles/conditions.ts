export type Predicate = {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  scheme?: "dark" | "light";
  motion?: "reduce" | "no-preference";
  hover?: true;
  active?: true;
  focus?: true;
};

const PSEUDOS: ReadonlySet<string> = new Set([":hover", ":active", ":focus"]);

export function isPseudo(key: string): boolean {
  return PSEUDOS.has(key);
}

export function isMedia(key: string): boolean {
  return key.startsWith("@media ");
}

export function isCondition(key: string): boolean {
  return key === "default" || isPseudo(key) || isMedia(key);
}

export function isConditionMap(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "default" in (value as Record<string, unknown>)
  );
}

function length(raw: string): number {
  const value = raw.trim();
  const match = /^(-?[\d.]+)(px|rem|em)?$/.exec(value);
  if (!match) throw new Error(`flypath: unsupported media length "${raw}"`);
  const number = Number(match[1]);
  return match[2] === "rem" || match[2] === "em" ? number * 16 : number;
}

const FEATURE =
  /^\(\s*(min-width|max-width|min-height|max-height|prefers-color-scheme|prefers-reduced-motion)\s*:\s*([^)]+)\)$/;

export function parseCondition(key: string): Predicate {
  if (isPseudo(key)) {
    if (key === ":hover") return { hover: true };
    if (key === ":active") return { active: true };
    return { focus: true };
  }
  if (!isMedia(key)) {
    throw new Error(`flypath: unsupported style condition "${key}"`);
  }

  const predicate: Predicate = {};
  for (const part of key.slice("@media ".length).split(" and ")) {
    const match = FEATURE.exec(part.trim());
    if (!match) {
      throw new Error(`flypath: unsupported media query "${key}"`);
    }
    const value = (match[2] ?? "").trim();
    switch (match[1]) {
      case "min-width":
        predicate.minWidth = length(value);
        break;
      case "max-width":
        predicate.maxWidth = length(value);
        break;
      case "min-height":
        predicate.minHeight = length(value);
        break;
      case "max-height":
        predicate.maxHeight = length(value);
        break;
      case "prefers-color-scheme":
        if (value !== "dark" && value !== "light") {
          throw new Error(`flypath: unsupported media query "${key}"`);
        }
        predicate.scheme = value;
        break;
      default:
        if (value !== "reduce" && value !== "no-preference") {
          throw new Error(`flypath: unsupported media query "${key}"`);
        }
        predicate.motion = value;
    }
  }
  return predicate;
}

export function validateConditionMap(
  property: string,
  map: Record<string, unknown>,
): void {
  for (const key of Object.keys(map)) {
    if (!isCondition(key)) {
      throw new Error(
        `flypath: unsupported condition "${key}" on property "${property}"`,
      );
    }
    if (key !== "default") parseCondition(key);
  }
}
