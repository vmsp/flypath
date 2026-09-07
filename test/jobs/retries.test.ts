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
import { currentJob } from "../../src/jobs/run.ts";
import type { Worker } from "../../src/jobs/worker.ts";
import { work } from "../../src/jobs/worker.ts";
import { byId, clear, schemaName, setup, teardown } from "./harness.ts";

const name = schemaName();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function until(
  check: () => Promise<boolean>,
  timeout = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(20);
  }
  return false;
}

let attempts: number[] = [];

async function flaky(succeedOn: number): Promise<string> {
  const { attempt } = currentJob();
  attempts.push(attempt);
  if (attempt < succeedOn) throw new Error(`not yet (${String(attempt)})`);
  return "finally";
}

async function doomed(): Promise<void> {
  attempts.push(currentJob().attempt);
  throw new Error("always broken");
}

const workers: Worker[] = [];

beforeAll(async () => {
  await setup(name, { queues: { default: { pollInterval: 0.25 } } });
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
  attempts = [];
  reset();
  register({ "app/jobs.ts#flaky": flaky, "app/jobs.ts#doomed": doomed });
});

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
});

describe("retries", () => {
  test("keeps trying until the attempt that succeeds", async () => {
    const id = (await jobs({ retries: 3 }).enqueue(() => [
      flaky,
      [3],
    ])) as number;
    workers.push(await work());

    expect(
      await until(async () => (await byId(name, id)).state === "done"),
    ).toBe(true);
    expect(attempts).toEqual([1, 2, 3]);
    const row = await byId(name, id);
    expect(row.attempts).toBe(3);
    expect(row.output).toBe("finally");
  });

  test("gives up after the configured number of retries", async () => {
    const id = (await jobs({ retries: 2 }).enqueue(() => [doomed])) as number;
    workers.push(await work());

    expect(
      await until(async () => (await byId(name, id)).state === "failed"),
    ).toBe(true);
    expect(attempts).toEqual([1, 2, 3]);
    const row = await byId(name, id);
    expect(row.attempts).toBe(3);
    expect(row.error).toMatch(/always broken/);
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  test("respects retries: 0 as a single attempt", async () => {
    const id = (await jobs({ retries: 0 }).enqueue(() => [doomed])) as number;
    workers.push(await work());

    expect(
      await until(async () => (await byId(name, id)).state === "failed"),
    ).toBe(true);
    expect(attempts).toEqual([1]);
  });
});
