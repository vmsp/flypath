import type { ReactNode } from "react";

import type { DbFactory } from "./db/index.ts";
import type { Db } from "./db/query.ts";
import type { SqlTag } from "./db/sql.ts";
import type { TransactionOptions } from "./db/transaction.ts";
import type {
  CronEntry,
  CronOptions,
  EnqueueOptions,
  Jobs,
  Thunk,
} from "./jobs/enqueue.ts";
import type { JobContext } from "./jobs/run.ts";
import type { Text } from "./mail/document.tsx";
import type { MailMessage, MailResult } from "./mail/transport.ts";

export * from "./index.shared.ts";
export type { Expression } from "./db/expression.ts";
export type { Db } from "./db/query.ts";
export type { NotFoundError } from "./db/sql.ts";
export type { TransactionOptions } from "./db/transaction.ts";
export type {
  CronEntry,
  CronOptions,
  EnqueueOptions,
  Jobs,
} from "./jobs/enqueue.ts";
export type { JobContext } from "./jobs/run.ts";
export type {
  Address,
  Attachment,
  MailMessage,
  MailResult,
} from "./mail/transport.ts";
export type { Text } from "./mail/document.tsx";
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

function create(_options?: { name?: string }): Db {
  return serverOnly("db");
}

function transaction<T>(
  _run: () => Promise<T>,
  _options?: TransactionOptions,
): Promise<T> {
  return serverOnly("transaction");
}

export const db: DbFactory = Object.assign(create, { transaction });

export const sql: SqlTag = Object.assign(
  (() => serverOnly("sql")) as unknown as SqlTag,
  {
    ref: () => serverOnly("sql"),
    raw: () => serverOnly("sql"),
    join: () => serverOnly("sql"),
  },
);

export function jobs(_options?: EnqueueOptions): Jobs {
  return serverOnly("jobs");
}

export function cron(
  _expression: string,
  _thunk: Thunk,
  _options?: CronOptions,
): CronEntry {
  return serverOnly("cron");
}

export function currentJob(): JobContext {
  return serverOnly("currentJob");
}

export function sendMail(_message: MailMessage): Promise<MailResult> {
  return serverOnly("sendMail");
}

export function Subject(_props: { children: Text }): ReactNode {
  return serverOnly("Subject");
}

export function Preview(_props: { children: Text }): ReactNode {
  return serverOnly("Preview");
}
