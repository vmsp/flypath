import type { DbFactory } from "./db/index.ts";
import type { Db } from "./db/query.ts";
import type { SqlTag } from "./db/sql.ts";
import type { TransactionOptions } from "./db/transaction.ts";
import type { cron as serverCron, jobs as serverJobs } from "./jobs/enqueue.ts";
import type { currentJob as serverCurrentJob } from "./jobs/run.ts";
import type {
  Preview as serverPreview,
  Subject as serverSubject,
} from "./mail/document.tsx";
import type { sendMail as serverSendMail } from "./mail/index.ts";

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

// Below we disallow usage of server-only functions in clients. We must be
// careful these re-definitions don't erase jsdocs. This file is the default
// export and likely to be the one picked up by LSPs.
//
// TODO: The checks only fire when the function called. Ideally, they'd
// automatically trigger as soon as they were added to the client graph.

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

export const jobs: typeof serverJobs = () => serverOnly("jobs");

export const cron: typeof serverCron = () => serverOnly("cron");

export const currentJob: typeof serverCurrentJob = () =>
  serverOnly("currentJob");

export const sendMail: typeof serverSendMail = () => serverOnly("sendMail");

export const Subject: typeof serverSubject = () => serverOnly("Subject");

export const Preview: typeof serverPreview = () => serverOnly("Preview");
