import { AsyncLocalStorage } from "node:async_hooks";

import type { Connection, TransactionConnection } from "./client.ts";
import { pool } from "./client.ts";

const KEY = "__flypathTransactions";

type Scope = Map<string, TransactionConnection>;

type Holder = { [KEY]?: AsyncLocalStorage<Scope> };

const holder = globalThis as unknown as Holder;

const storage: AsyncLocalStorage<Scope> = (holder[KEY] ??=
  new AsyncLocalStorage<Scope>());

export function currentConnection(name: string): Connection | undefined {
  return storage.getStore()?.get(name) as Connection | undefined;
}

export type TransactionOptions = {
  name?: string;
  isolation?:
    | "read committed"
    | "repeatable read"
    | "serializable"
    | "read uncommitted";
  readOnly?: boolean;
  deferrable?: boolean;
};

function modeOf(options: TransactionOptions): string {
  const parts: string[] = [];
  if (options.isolation) parts.push(`isolation level ${options.isolation}`);
  if (options.readOnly !== undefined) {
    parts.push(options.readOnly ? "read only" : "read write");
  }
  if (options.deferrable) parts.push("deferrable");
  return parts.join(" ");
}

export function transaction<T>(
  run: () => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const name = options.name ?? "default";
  const outer = storage.getStore();
  const existing = outer?.get(name);

  if (existing) {
    return existing.savepoint(async (savepoint) => {
      const scope: Scope = new Map(outer);
      scope.set(name, savepoint);
      return storage.run(scope, run);
    }) as Promise<T>;
  }

  const mode = modeOf(options);
  const begin = (
    handler: (tx: TransactionConnection) => Promise<T>,
  ): Promise<T> =>
    (mode === ""
      ? pool(name).begin(handler)
      : pool(name).begin(mode, handler)) as Promise<T>;

  return begin(async (tx) => {
    const scope: Scope = new Map(outer);
    scope.set(name, tx);
    return storage.run(scope, run);
  });
}
