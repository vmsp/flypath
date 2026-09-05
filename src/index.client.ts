import type { Db } from "./db/query.ts";
import type { SqlTag } from "./db/sql.ts";
import type { TransactionOptions } from "./db/transaction.ts";

export * from "./index.shared.ts";
export type { Expression } from "./db/expression.ts";
export type { Db } from "./db/query.ts";
export type { NotFoundError } from "./db/sql.ts";
export type { TransactionOptions } from "./db/transaction.ts";
export type {
  Insertable,
  Row,
  Schema,
  Selectable,
  TableName,
  TableRow,
  Updatable,
} from "./db/types.ts";
export { navigate } from "./router/navigate-client.ts";
export { revalidate } from "./router/revalidate-client.ts";
export { params, query, useBranches } from "./router/scope.tsx";
export type { Branch } from "./router/scope.tsx";

export interface Register {}

function serverOnly(name: string): never {
  throw new Error(
    `flypath: ${name}() only runs on the server; call it from a server ` +
      "component, a server action or a middleware",
  );
}

export function db(_options?: { name?: string }): Db {
  return serverOnly("db");
}

export const sql: SqlTag = Object.assign(
  (() => serverOnly("sql")) as unknown as SqlTag,
  {
    ref: () => serverOnly("sql"),
    raw: () => serverOnly("sql"),
    join: () => serverOnly("sql"),
  },
);

export function transaction<T>(
  _run: () => Promise<T>,
  _options?: TransactionOptions,
): Promise<T> {
  return serverOnly("transaction");
}
