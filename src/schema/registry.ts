import { singleton } from "../shared/globals.ts";

const registry: Map<string, readonly string[]> = singleton(
  "tableColumns",
  () => new Map<string, readonly string[]>(),
);

export function registerTable(name: string, columns: readonly string[]): void {
  registry.set(name, columns);
}

export function tableColumns(name: string): readonly string[] | null {
  return registry.get(name) ?? null;
}
