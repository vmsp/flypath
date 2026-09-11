import { AsyncLocalStorage } from "node:async_hooks";

import { report } from "../shared/events.ts";
import { singleton } from "../shared/globals.ts";
import { jobById } from "./registry.ts";
import type { JobRow } from "./schema.ts";
import { complete, discard, fail } from "./schema.ts";

export type JobContext = {
  /** Job ID. */
  id: number;
  /** Which attempt this is, starting at 1 on the first run. */
  attempt: number;
  /** Aborts when the attempt times out or the worker shuts down. */
  signal: AbortSignal;
};

const storage: AsyncLocalStorage<JobContext> = singleton(
  "jobStorage",
  () => new AsyncLocalStorage<JobContext>(),
);

/**
 * Information about the job attempt that's currently executing. Throws when
 * called outside a job.
 *
 * The context is read-only: a job can observe `signal` to stop early when it
 * times out or the worker shuts down, but it can't change its own retry or
 * timeout settings.
 */
export function currentJob(): JobContext {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "currentJob() only runs inside a job; enqueue it with jobs()",
    );
  }
  return store;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function jobName(id: string): string {
  return id.slice(id.lastIndexOf("#") + 1);
}

function retryDelay(row: JobRow): number {
  const seconds = row.backoff
    ? row.retryDelay * 2 ** (row.attempts - 1)
    : row.retryDelay;
  return seconds * 1000;
}

export async function runJob(
  database: string,
  row: JobRow,
  shutdown: AbortSignal,
): Promise<void> {
  const fence = row.lockedBy ?? "";
  const started = performance.now();
  const base = {
    kind: "job",
    job: jobName(row.job),
    attempt: row.attempts,
    attempts: row.maxAttempts,
  } as const;

  const fn = jobById(row.job);
  if (!fn) {
    const error = `no job registered as ${row.job}`;
    if (await discard(database, row.id, error, fence)) {
      report({ ...base, state: "failed", ms: 0, error });
    }
    return;
  }

  const controller = new AbortController();
  const onShutdown = (): void => {
    if (!controller.signal.aborted) controller.abort(new Error("shutdown"));
  };
  shutdown.addEventListener("abort", onShutdown, { once: true });

  const context: JobContext = {
    id: row.id,
    attempt: row.attempts,
    signal: controller.signal,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!controller.signal.aborted) controller.abort(new Error("timeout"));
        reject(new Error("timeout"));
      }, row.timeout * 1000);
    });
    const output = await Promise.race([
      storage.run(context, () =>
        Promise.resolve((fn as (...args: unknown[]) => unknown)(...row.args)),
      ),
      expiry,
    ]);
    if (await complete(database, row.id, output, fence)) {
      report({ ...base, state: "done", ms: performance.now() - started });
    }
  } catch (error) {
    const state = await fail(database, row.id, describe(error), fence);
    if (state === "retry" || state === "failed") {
      report({
        ...base,
        state,
        ms: performance.now() - started,
        ...(state === "retry" ? { retryIn: retryDelay(row) } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    clearTimeout(timer);
    shutdown.removeEventListener("abort", onShutdown);
  }
}
