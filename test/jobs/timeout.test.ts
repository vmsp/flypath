import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { jobs } from "../../src/jobs/enqueue.ts";
import { register, reset } from "../../src/jobs/registry.ts";
import { currentJob, runJob } from "../../src/jobs/run.ts";
import { claim, complete, insert } from "../../src/jobs/schema.ts";
import { byId, clear, job, schemaName, setup, teardown } from "./harness.ts";

const name = schemaName();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let aborted: string[] = [];

let finished: string[] = [];

async function obedient(): Promise<void> {
  const { signal } = currentJob();
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => {
      aborted.push("obedient");
      resolve();
    });
    setTimeout(resolve, 10_000);
  });
  throw new Error("aborted");
}

async function stubborn(ms: number): Promise<string> {
  await sleep(ms);
  finished.push("stubborn");
  return "late";
}

beforeAll(async () => {
  await setup(name, { queues: { default: {} } });
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
  aborted = [];
  finished = [];
  reset();
  register({
    "app/jobs.ts#obedient": obedient,
    "app/jobs.ts#stubborn": stubborn,
  });
});

describe("timeouts", () => {
  test("aborts the signal at the deadline and retries at once", async () => {
    const id = (await jobs({ timeout: 1, retries: 1 }).enqueue(() => [
      obedient,
    ])) as number;
    const row = await claim(name, "default", "w1");
    const at = Date.now();
    await runJob(name, row as never, new AbortController().signal);

    expect(aborted).toEqual(["obedient"]);
    expect(Date.now() - at).toBeGreaterThan(900);
    const after = await byId(name, id);
    expect(after.state).toBe("retry");
    expect(after.error).toMatch(/timeout/);
    expect(after.lockedBy).toBeNull();
  }, 10_000);

  test("discards a late result once the attempt has expired", async () => {
    const id = (await jobs({ timeout: 1, retries: 2 }).enqueue(() => [
      stubborn,
      [1400],
    ])) as number;

    const first = await claim(name, "default", "w1");
    const late = runJob(name, first as never, new AbortController().signal);
    await sleep(1200);

    expect((await byId(name, id)).state).toBe("retry");
    const second = await claim(name, "default", "w2");
    expect(second?.lockedBy).toBe("w2:2");

    await late;
    await sleep(400);

    expect(finished).toEqual(["stubborn"]);
    const row = await byId(name, id);
    expect(row.state).toBe("active");
    expect(row.lockedBy).toBe("w2:2");
    expect(row.output).toBeNull();
  }, 10_000);

  test("a write fenced on an expired attempt changes nothing", async () => {
    const [id] = await insert(name, [job({ timeout: 1 })]);
    const first = await claim(name, "default", "w1");
    expect(first?.lockedBy).toBe("w1:1");

    const { sweep } = await import("../../src/jobs/schema.ts");
    await sleep(1100);
    await sweep(name);
    const second = await claim(name, "default", "w2");
    expect(second?.lockedBy).toBe("w2:2");

    expect(
      await complete(name, id as number, "late", first?.lockedBy as string),
    ).toBeUndefined();
    expect((await byId(name, id as number)).state).toBe("active");
  }, 10_000);

  test("fails a job nobody registered without another attempt", async () => {
    const [id] = await insert(name, [
      job({ job: "app/gone.ts#missing", maxAttempts: 5 }),
    ]);
    const row = await claim(name, "default", "w1");
    await runJob(name, row as never, new AbortController().signal);

    const after = await byId(name, id as number);
    expect(after.state).toBe("failed");
    expect(after.attempts).toBe(after.maxAttempts);
    expect(after.error).toMatch(/no job registered as app\/gone\.ts#missing/);
  });
});
