import type { Scalar } from "./shorthands.ts";

export type Frames = Record<string, Record<string, Scalar>>;

const vars = new Map<string, Scalar | Record<string, Scalar>>();
const keyframes = new Map<string, Frames>();

export function registerVars(
  entries: Record<string, Scalar | Record<string, Scalar>>,
): void {
  for (const [name, value] of Object.entries(entries)) vars.set(name, value);
}

export function registerKeyframes(entries: Record<string, Frames>): void {
  for (const [name, frames] of Object.entries(entries)) {
    keyframes.set(name, frames);
  }
}

export function lookupVar(
  name: string,
): Scalar | Record<string, Scalar> | undefined {
  return vars.get(name);
}

export function lookupKeyframes(name: string): Frames | undefined {
  return keyframes.get(name);
}
