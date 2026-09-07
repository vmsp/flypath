import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { jobs } from "../../src/jobs/enqueue.ts";
import { register, reset } from "../../src/jobs/registry.ts";
import type { Worker } from "../../src/jobs/worker.ts";
import { work } from "../../src/jobs/worker.ts";
import { byId, clear, rows, schemaName, setup, teardown } from "./harness.ts";

const name = schemaName();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function until(
  check: () => Promise<boolean>,
  timeout = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(20);
  }
  return false;
}

let calls: unknown[][] = [];

async function record(...args: unknown[]): Promise<string> {
  calls.push(args);
  return `saw ${String(args.length)}`;
}

async function slow(ms: number): Promise<string> {
  await sleep(ms);
  calls.push([ms]);
  return "slept";
}

const workers: Worker[] = [];

const start = async (options?: Parameters<typeof work>[0]): Promise<Worker> => {
  const worker = await work(options);
  workers.push(worker);
  return worker;
};

beforeAll(async () => {
  await setup(name, {
    queues: {
      default: { pollInterval: 30 },
      quiet: { notify: false, pollInterval: 1 },
      fast: { pollInterval: 0.25 },
      wide: { concurrency: 5, pollInterval: 0.25 },
    },
  });
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
  calls = [];
  reset();
  register({ "app/jobs.ts#record": record, "app/jobs.ts#slow": slow });
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
});

describe("the worker", () => {
  test("runs the call and stores what it returned", async () => {
    const id = (await jobs().enqueue(() => [record, [1, "two"]])) as number;
    await start();
    expect(
      await until(async () => (await byId(name, id)).state === "done"),
    ).toBe(true);
    expect(calls).toEqual([[1, "two"]]);
    expect((await byId(name, id)).output).toBe("saw 2");
  });

  test("wakes within half a second on a queue that notifies", async () => {
    await start({ queues: ["default"] });
    await sleep(150);
    const at = Date.now();
    const id = (await jobs().enqueue(() => [record, [1]])) as number;
    expect(
      await until(async () => (await byId(name, id)).state === "done", 900),
    ).toBe(true);
    expect(Date.now() - at).toBeLessThan(900);
  });

  test("waits for the poll on a queue that does not notify", async () => {
    await start({ queues: ["quiet"] });
    await sleep(150);
    const id = (await jobs({ queue: "quiet" }).enqueue(() => [
      record,
      [1],
    ])) as number;
    await sleep(300);
    expect((await byId(name, id)).state).toBe("queued");
    expect(
      await until(async () => (await byId(name, id)).state === "done", 3000),
    ).toBe(true);
  });

  test("holds a delayed job until its run_at", async () => {
    const id = (await jobs({ queue: "fast", delay: 1 }).enqueue(() => [
      record,
      [1],
    ])) as number;
    await start({ queues: ["fast"] });
    await sleep(400);
    expect((await byId(name, id)).state).toBe("queued");
    expect(
      await until(async () => (await byId(name, id)).state === "done", 3000),
    ).toBe(true);
  });

  test("never lets two workers run the same job", async () => {
    const thunks = Array.from(
      { length: 50 },
      (_, index) => () => [record, [index]] as unknown,
    );
    await jobs({ queue: "wide" }).enqueue(...thunks);

    await start({ queues: ["wide"] });
    await start({ queues: ["wide"] });

    expect(
      await until(async () => {
        const written = await rows(name);
        return written.every((row) => row.state === "done");
      }, 15_000),
    ).toBe(true);

    expect(calls).toHaveLength(50);
    expect(new Set(calls.map(([index]) => index)).size).toBe(50);
  }, 20_000);

  test("drains an active job before shutdown returns", async () => {
    const id = (await jobs({ queue: "fast" }).enqueue(() => [
      slow,
      [400],
    ])) as number;
    const worker = await start({ queues: ["fast"] });
    expect(
      await until(async () => (await byId(name, id)).state === "active", 3000),
    ).toBe(true);

    await worker.stop();
    workers.splice(workers.indexOf(worker), 1);
    expect((await byId(name, id)).state).toBe("done");
  });

  test("serves only the queues it was given", async () => {
    const mine = (await jobs({ queue: "fast" }).enqueue(() => [
      record,
      [1],
    ])) as number;
    const other = (await jobs({ queue: "quiet" }).enqueue(() => [
      record,
      [2],
    ])) as number;
    await start({ queues: ["fast"] });

    expect(
      await until(async () => (await byId(name, mine)).state === "done", 3000),
    ).toBe(true);
    expect((await byId(name, other)).state).toBe("queued");
  });
});
