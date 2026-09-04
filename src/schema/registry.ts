const KEY = "__flypathTableColumns";

type Holder = { [KEY]?: Map<string, readonly string[]> };

const holder = globalThis as unknown as Holder;

const registry: Map<string, readonly string[]> = (holder[KEY] ??= new Map<
  string,
  readonly string[]
>());

export function registerTable(name: string, columns: readonly string[]): void {
  registry.set(name, columns);
}

export function tableColumns(name: string): readonly string[] | null {
  return registry.get(name) ?? null;
}
