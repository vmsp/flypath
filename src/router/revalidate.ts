import type { Revalidate } from "./types.ts";

export type RevalidateMode = "stale" | "reset" | "none";

export type Run = (mode: RevalidateMode) => void;

export function makeRevalidate(run: Run): Revalidate {
  return Object.assign(() => run("stale"), {
    reset: () => run("reset"),
    none: () => run("none"),
  });
}

export function parseRevalidate(
  value: string | null | undefined,
): RevalidateMode | undefined {
  if (value === "stale" || value === "reset" || value === "none") return value;
  return undefined;
}
