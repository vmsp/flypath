import { AsyncLocalStorage } from "node:async_hooks";

import { singleton } from "../globals.ts";
import { jobById } from "./registry.ts";
import type { JobRow } from "./schema.ts";
import { complete, discard, fail } from "./schema.ts";

export type JobContext = {
  id: number;
  job: string;
  queue: string;
  attempt: number;
  signal: AbortSignal;
};

const storage: AsyncLocalStorage<JobContext> = singleton(
  "jobStorage",
  () => new AsyncLocalStorage<JobContext>(),
);

export function currentJob(): JobContext {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "flypath: currentJob() only runs inside a job; enqueue it with jobs()",
    );
  }
  return store;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export async function runJob(
  database: string,
  row: JobRow,
  shutdown: AbortSignal,
): Promise<void> {
  const fence = row.lockedBy ?? "";
  const fn = jobById(row.job);
  if (!fn) {
    await discard(database, row.id, `no job registered as ${row.job}`, fence);
    return;
  }

  const controller = new AbortController();
  const onShutdown = (): void => {
    if (!controller.signal.aborted) controller.abort(new Error("shutdown"));
  };
  shutdown.addEventListener("abort", onShutdown, { once: true });

  const context: JobContext = {
    id: row.id,
    job: row.job,
    queue: row.queue,
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
    await complete(database, row.id, output, fence);
  } catch (error) {
    await fail(database, row.id, describe(error), fence);
  } finally {
    clearTimeout(timer);
    shutdown.removeEventListener("abort", onShutdown);
  }
}
