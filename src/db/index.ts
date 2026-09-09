import { Db } from "./query.ts";
import type { TransactionOptions } from "./transaction.ts";
import { transaction } from "./transaction.ts";

export type DbFactory = {
  /** Start a query against a configured database, `"default"` unless named. */
  (options?: { name?: string }): Db<Record<never, never>>;
  /**
   * Run `run` inside a transaction, joining the surrounding one as a savepoint
   * when there already is one.
   */
  transaction: <T>(
    run: () => Promise<T>,
    options?: TransactionOptions,
  ) => Promise<T>;
};

function create(options: { name?: string } = {}): Db<Record<never, never>> {
  return new Db<Record<never, never>>(options.name ?? "default");
}

export const db: DbFactory = Object.assign(create, { transaction });
