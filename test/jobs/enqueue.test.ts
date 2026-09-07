import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { transaction } from "../../src/db/transaction.ts";
import { jobs } from "../../src/jobs/enqueue.ts";
import { register, reset } from "../../src/jobs/registry.ts";
import { clear, rows, schemaName, setup, teardown } from "./harness.ts";

const name = schemaName();

async function resize(..._args: unknown[]): Promise<void> {}

async function digest(..._args: unknown[]): Promise<void> {}

beforeAll(async () => {
  await setup(name, {
    queues: {
      default: {},
      images: { retries: 5, retryDelay: 30, backoff: true, timeout: 600 },
    },
  });
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
  reset();
  register({
    "app/images.ts#resize": resize,
    "app/reports.ts#digest": digest,
  });
});

describe("enqueue", () => {
  test("writes the call and returns the row id", async () => {
    const id = await jobs().enqueue(() => [resize, [7, "large"]]);
    const [row] = await rows(name);
    expect(id).toBe(row?.id);
    expect(row?.job).toBe("app/images.ts#resize");
    expect(row?.args).toEqual([7, "large"]);
    expect(row?.queue).toBe("default");
    expect(row?.state).toBe("queued");
  });

  test("layers the call over the queue over the defaults", async () => {
    await jobs({ queue: "images" }).enqueue(() => [resize, [1]]);
    await jobs({
      queue: "images",
      retries: 0,
      timeout: 5,
      priority: 9,
    }).enqueue(() => [resize, [2]]);
    await jobs().enqueue(() => [resize, [3]]);

    const [queued, overridden, fallback] = await rows(name);
    expect(queued).toMatchObject({
      maxAttempts: 6,
      retryDelay: 30,
      backoff: true,
      timeout: 600,
      priority: 0,
    });
    expect(overridden).toMatchObject({
      maxAttempts: 1,
      timeout: 5,
      priority: 9,
      retryDelay: 30,
    });
    expect(fallback).toMatchObject({
      maxAttempts: 3,
      retryDelay: 0,
      backoff: false,
      timeout: 900,
    });
  });

  test("returns an array for several thunks and writes them at once", async () => {
    const ids = await jobs().enqueue(
      () => [resize, [1]],
      () => [resize, [2]],
      () => [digest, ["daily"]],
    );
    expect(ids).toHaveLength(3);
    const written = await rows(name);
    expect(written.map((row) => row.id)).toEqual(ids);
    expect(written.map((row) => row.args)).toEqual([[1], [2], ["daily"]]);
  });

  test("delays a job by seconds and by an explicit date", async () => {
    await jobs({ delay: 60 }).enqueue(() => [resize, [1]]);
    const at = new Date(Date.now() + 3_600_000);
    await jobs({ at }).enqueue(() => [resize, [2]]);

    const [delayed, scheduled] = await rows(name);
    const delta =
      ((delayed as { runAt: Date }).runAt.getTime() - Date.now()) / 1000;
    expect(delta).toBeGreaterThan(55);
    expect(delta).toBeLessThan(65);
    expect((scheduled as { runAt: Date }).runAt.getTime()).toBe(at.getTime());
  });

  test("refuses an undeclared queue before touching the database", async () => {
    await expect(
      jobs({ queue: "nope" }).enqueue(() => [resize, [1]]),
    ).rejects.toThrow(/there is no "nope" queue/);
    expect(await rows(name)).toEqual([]);
  });

  test("rolls back with the transaction that wrote it", async () => {
    await expect(
      transaction(
        async () => {
          await jobs().enqueue(() => [resize, [1]]);
          throw new Error("no");
        },
        { name },
      ),
    ).rejects.toThrow("no");
    expect(await rows(name)).toEqual([]);
  });

  test("commits with the transaction that wrote it", async () => {
    await transaction(
      async () => {
        await jobs().enqueue(() => [resize, [1]]);
      },
      { name },
    );
    expect(await rows(name)).toHaveLength(1);
  });
});

describe("dedup", () => {
  test("collapses the same unique call to one row", async () => {
    const first = await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    const second = await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    expect(typeof first).toBe("number");
    expect(second).toBeNull();
    expect(await rows(name)).toHaveLength(1);
  });

  test("keeps distinct arguments apart", async () => {
    await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    await jobs({ unique: true }).enqueue(() => [resize, [2]]);
    expect(await rows(name)).toHaveLength(2);
  });

  test("frees the key once the first row is claimed", async () => {
    const { claim } = await import("../../src/jobs/schema.ts");
    await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    await claim(name, "default", "w1");
    const again = await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    expect(typeof again).toBe("number");
    expect(await rows(name)).toHaveLength(2);
  });

  test("leaves a job that is not unique alone", async () => {
    await jobs().enqueue(() => [resize, [1]]);
    await jobs().enqueue(() => [resize, [1]]);
    expect(await rows(name)).toHaveLength(2);
  });

  test("reports which of a bulk enqueue was deduplicated", async () => {
    await jobs({ unique: true }).enqueue(() => [resize, [1]]);
    const ids = await jobs({ unique: true }).enqueue(
      () => [resize, [1]],
      () => [resize, [2]],
    );
    expect(ids[0]).toBeNull();
    expect(typeof ids[1]).toBe("number");
  });
});
