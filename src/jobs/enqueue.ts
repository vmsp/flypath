import { createHash } from "node:crypto";

import type { Queue } from "./config.ts";
import { jobsDatabase, queue as queueConfig } from "./config.ts";
import { idOf } from "./registry.ts";
import type { NewJob } from "./schema.ts";
import { insert, notify } from "./schema.ts";

export type Thunk = () => unknown;

export type EnqueueOptions = {
  queue?: string;
  priority?: number;
  unique?: boolean;
  delay?: number;
  at?: Date;
  retries?: number;
  retryDelay?: number;
  backoff?: boolean;
  timeout?: number;
};

export type CronOptions = Omit<EnqueueOptions, "delay" | "at"> & {
  timezone?: string;
  name?: string;
};

export type CronEntry = {
  expression: string;
  thunk: Thunk;
  options: CronOptions;
};

type Enqueue = {
  (thunk: Thunk): Promise<number | null>;
  (...thunks: readonly Thunk[]): Promise<(number | null)[]>;
};

export type Jobs = { enqueue: Enqueue };

export type Call = { id: string; args: unknown[] };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

export function argsHash(args: readonly unknown[]): string {
  return createHash("sha1").update(canonical(args)).digest("hex");
}

function keyOf(id: string, args: readonly unknown[]): string {
  return createHash("sha1")
    .update(`${id}${canonical(args)}`)
    .digest("hex");
}

function notAJob(value: unknown): Error {
  const name =
    typeof value === "function" && value.name !== ""
      ? value.name
      : "the callee";
  return new Error(
    `flypath: ${name} is not a job: it must be an export of a module the ` +
      "scan can see, called from an arrow literal",
  );
}

export async function resolveThunk(thunk: Thunk): Promise<Call> {
  const direct = idOf(thunk);
  if (direct !== undefined) return { id: direct, args: [] };

  const value = await thunk();
  if (Array.isArray(value) && typeof value[0] === "function") {
    const id = idOf(value[0]);
    if (id !== undefined) {
      return { id, args: (value[1] as unknown[] | undefined) ?? [] };
    }
    throw notAJob(value[0]);
  }
  throw notAJob(thunk);
}

function newJob(
  call: Call,
  options: EnqueueOptions,
  target: Queue,
  runAt: Date,
): NewJob {
  return {
    queue: target.name,
    job: call.id,
    args: call.args,
    key: options.unique === true ? keyOf(call.id, call.args) : null,
    priority: options.priority ?? 0,
    runAt,
    maxAttempts: (options.retries ?? target.retries) + 1,
    retryDelay: options.retryDelay ?? target.retryDelay,
    backoff: options.backoff ?? target.backoff,
    timeout: options.timeout ?? target.timeout,
  };
}

export function cronJob(call: Call, entry: CronEntry): NewJob {
  const target = queueConfig(entry.options.queue ?? "default");
  return newJob(call, entry.options, target, new Date());
}

async function enqueueAll(
  options: EnqueueOptions,
  thunks: readonly Thunk[],
): Promise<(number | null)[]> {
  const target = queueConfig(options.queue ?? "default");
  const calls = await Promise.all(thunks.map(resolveThunk));
  const runAt =
    options.at ?? new Date(Date.now() + (options.delay ?? 0) * 1000);
  const rows = calls.map((call) => newJob(call, options, target, runAt));

  const database = jobsDatabase();
  const ids = await insert(database, rows);

  const immediate = runAt.getTime() <= Date.now();
  if (target.notify && immediate && ids.some((id) => id !== null)) {
    await notify(database, target.name);
  }
  return ids;
}

/**
 * Enqueue background jobs: `jobs({ queue: "mail" }).enqueue(() => send(id))`.
 *
 * The thunk's callee and arguments are what gets stored, so it must call an
 * exported function with serializable arguments.
 */
export function jobs(options: EnqueueOptions = {}): Jobs {
  const enqueue = async (
    ...thunks: readonly Thunk[]
  ): Promise<(number | null) | (number | null)[]> => {
    const ids = await enqueueAll(options, thunks);
    return thunks.length === 1 ? (ids[0] ?? null) : ids;
  };
  return { enqueue: enqueue as unknown as Enqueue };
}

/**
 * Declare a job that runs on a cron schedule. Entries are picked up from the
 * default export of `app/crons.ts`.
 */
export function cron(
  expression: string,
  thunk: Thunk,
  options: CronOptions = {},
): CronEntry {
  return { expression, thunk, options };
}
