import os from "node:os";

import { Cron } from "croner";

import { pool } from "../db/client.ts";
import { report as reportEvent } from "../shared/events.ts";
import type { Queue } from "./config.ts";
import {
  jobsDatabase,
  queue as queueConfig,
  queueNames,
  retention,
} from "./config.ts";
import type { CronEntry } from "./enqueue.ts";
import { argsHash, cronJob, resolveThunk } from "./enqueue.ts";
import { crons } from "./registry.ts";
import { runJob } from "./run.ts";
import type { NewJob } from "./schema.ts";
import { claim, insertCron, install, minute, purge, sweep } from "./schema.ts";

export type WorkOptions = {
  queues?: readonly string[];
  concurrency?: number;
};

export type Worker = {
  id: string;
  stop: () => Promise<void>;
};

const SWEEP_INTERVAL = 30_000;

const PURGE_INTERVAL = 3_600_000;

const GRACE = 10_000;

const MINUTE = 60_000;

type Waiter = { wait: (ms: number) => Promise<void>; open: () => void };

function waiter(): Waiter {
  let release: (() => void) | undefined;
  return {
    wait(ms) {
      return new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          release = undefined;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        release = finish;
      });
    },
    open() {
      release?.();
    },
  };
}

function identity(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${os.hostname()}:${String(process.pid)}:${random}`;
}

function report(error: unknown): void {
  if (!reportEvent({ kind: "error", error })) console.error(error);
}

export type Scheduled = { key: string; cron: Cron; row: NewJob };

export async function schedule(
  entries: readonly CronEntry[],
): Promise<Scheduled[]> {
  const out: Scheduled[] = [];
  for (const entry of entries) {
    const call = await resolveThunk(entry.thunk);
    const timezone = entry.options.timezone;
    const cron = new Cron(
      entry.expression,
      timezone === undefined ? {} : { timezone },
    );
    if (!cron.nextRun()) {
      throw new Error(`The cron expression "${entry.expression}" never runs`);
    }
    const key =
      entry.options.name ??
      `${call.id}@${entry.expression}#${argsHash(call.args)}`;
    out.push({ key, cron, row: cronJob(call, entry) });
  }
  return out;
}

export async function fire(
  database: string,
  scheduled: readonly Scheduled[],
): Promise<void> {
  const at = await minute(database);
  const previous = new Date(at.getTime() - MINUTE);
  for (const entry of scheduled) {
    const due = entry.cron.nextRun(previous);
    if (!due || due.getTime() > at.getTime()) continue;
    await insertCron(database, { ...entry.row, runAt: at }, entry.key, at);
  }
}

export async function work(options: WorkOptions = {}): Promise<Worker> {
  const database = jobsDatabase();
  await install(database);

  const id = identity();
  const names = options.queues ?? queueNames();
  const queues = names.map((name) => queueConfig(name));
  const shutdown = new AbortController();
  const gates = new Map<string, Waiter>(
    queues.map((target) => [target.name, waiter()]),
  );
  const tickers: Waiter[] = [];
  const running = new Set<Promise<void>>();
  const state = { stopping: false };

  const subscription = queues.some((target) => target.notify)
    ? await pool(database).listen("flypath_jobs", (payload) => {
        gates.get(payload)?.open();
      })
    : undefined;

  const loop = async (target: Queue): Promise<void> => {
    const gate = gates.get(target.name) as Waiter;
    const limit = options.concurrency ?? target.concurrency;
    let active = 0;

    while (!state.stopping) {
      if (active >= limit) {
        await gate.wait(SWEEP_INTERVAL);
        continue;
      }
      let row;
      try {
        row = await claim(database, target.name, id);
      } catch (error) {
        report(error);
      }
      if (!row) {
        if (state.stopping) break;
        await gate.wait(target.pollInterval * 1000);
        continue;
      }
      active += 1;
      const task = (async () => {
        try {
          await runJob(database, row, shutdown.signal);
        } catch (error) {
          report(error);
        } finally {
          active -= 1;
          gate.open();
        }
      })();
      running.add(task);
      void task.then(() => running.delete(task));
    }
  };

  const ticker = async (
    interval: number | (() => number),
    run: () => Promise<void>,
  ): Promise<void> => {
    const gate = waiter();
    tickers.push(gate);
    while (!state.stopping) {
      const delay = typeof interval === "number" ? interval : interval();
      if (state.stopping) break;
      await gate.wait(delay);
      if (state.stopping) break;
      try {
        await run();
      } catch (error) {
        report(error);
      }
    }
  };

  const scheduled = await schedule(crons());

  const loops = [
    ...queues.map(loop),
    ticker(SWEEP_INTERVAL, async () => {
      await sweep(database);
    }),
    ticker(PURGE_INTERVAL, async () => {
      await purge(database, retention());
    }),
    ...(scheduled.length === 0
      ? []
      : [
          ticker(
            () => {
              const now = Date.now();
              const next =
                Math.floor(now / MINUTE) * MINUTE +
                MINUTE +
                250 +
                Math.floor(Math.random() * 750);
              return next - now;
            },
            async () => {
              await fire(database, scheduled);
            },
          ),
        ]),
  ];

  const stop = async (): Promise<void> => {
    if (state.stopping) return;
    state.stopping = true;
    for (const gate of gates.values()) gate.open();
    for (const gate of tickers) gate.open();
    await Promise.all(loops);

    const grace = setTimeout(() => {
      shutdown.abort(new Error("shutdown"));
    }, GRACE);
    await Promise.all(running);
    clearTimeout(grace);
    await subscription?.unlisten();
  };

  return { id, stop };
}
