import { Db } from "./query.ts";
import type { TransactionOptions } from "./transaction.ts";
import { transaction } from "./transaction.ts";

export type DbFactory = {
  (options?: { name?: string }): Db<Record<never, never>>;
  transaction: <T>(
    run: () => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>;
};

function create(options: { name?: string } = {}): Db<Record<never, never>> {
  return new Db<Record<never, never>>(options.name ?? "default");
}

export const db: DbFactory = Object.assign(create, { transaction });
