import { isUnitless } from "./properties.ts";
import type { Scalar } from "./shorthands.ts";

export function cssValue(property: string, value: Scalar): string {
  if (typeof value === "number" && value !== 0 && !isUnitless(property)) {
    return `${value}px`;
  }
  return String(value);
}
