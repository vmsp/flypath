import { singleton } from "../globals.ts";
import type { CronEntry } from "./enqueue.ts";

export type JobFunction = (...args: never[]) => unknown;

/** @lintignore */
export type Registry = {
  byId: Map<string, JobFunction>;
  byFn: WeakMap<object, string>;
  crons: readonly CronEntry[];
};

const registry: Registry = singleton("jobRegistry", () => ({
  byId: new Map<string, JobFunction>(),
  byFn: new WeakMap<object, string>(),
  crons: [],
}));

export function register(
  map: Record<string, unknown>,
  crons: readonly CronEntry[] = [],
): void {
  for (const [id, value] of Object.entries(map)) {
    if (typeof value !== "function") continue;
    registry.byId.set(id, value as JobFunction);
    registry.byFn.set(value, id);
  }
  registry.crons = crons;
}

export function reset(): void {
  registry.byId.clear();
  registry.byFn = new WeakMap<object, string>();
  registry.crons = [];
}

export function jobById(id: string): JobFunction | undefined {
  return registry.byId.get(id);
}

export function idOf(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  return registry.byFn.get(value);
}

export function crons(): readonly CronEntry[] {
  return registry.crons;
}
