import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { pool } from "../../src/db/client.ts";
import { transaction } from "../../src/db/transaction.ts";
import {
  claim,
  complete,
  discard,
  fail,
  insert,
  purge,
  sweep,
  TABLE,
} from "../../src/jobs/schema.ts";
import {
  byId,
  clear,
  job,
  rows,
  schemaName,
  setup,
  teardown,
} from "./harness.ts";

const name = schemaName();

const seconds = (delta: number): Date => new Date(Date.now() + delta * 1000);

beforeAll(async () => {
  await setup(name);
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
});

describe("install", () => {
  test("is idempotent and survives a concurrent run", async () => {
    const { install } = await import("../../src/jobs/schema.ts");
    await Promise.all([install(name), install(name), install(name)]);
    const [row] = (await pool(name).unsafe(
      "select count(*)::int as tables from pg_tables where schemaname = $1 " +
        "and tablename = $2",
      [name, TABLE] as never[],
    )) as unknown as { tables: number }[];
    expect(row?.tables).toBe(1);
  });
});

describe("claim", () => {
  test("takes the highest priority first, then the oldest run_at", async () => {
    await insert(name, [
      job({ job: "a", runAt: seconds(-30) }),
      job({ job: "b", runAt: seconds(-60) }),
      job({ job: "c", priority: 10, runAt: seconds(-1) }),
    ]);

    const first = await claim(name, "default", "w1");
    const second = await claim(name, "default", "w1");
    const third = await claim(name, "default", "w1");

    expect([first?.job, second?.job, third?.job]).toEqual(["c", "b", "a"]);
    expect(first?.attempts).toBe(1);
    expect(first?.state).toBe("active");
    expect(first?.lockedBy).toBe("w1:1");
  });

  test("skips a job whose run_at is in the future", async () => {
    await insert(name, [job({ runAt: seconds(60) })]);
    expect(await claim(name, "default", "w1")).toBeUndefined();
  });

  test("only claims from the queue it is asked for", async () => {
    await insert(name, [job({ queue: "images" })]);
    expect(await claim(name, "default", "w1")).toBeUndefined();
    expect((await claim(name, "images", "w1"))?.queue).toBe("images");
  });

  test("gives two open transactions different rows", async () => {
    await insert(name, [job({ job: "a" }), job({ job: "b" })]);

    const gate = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    const seen: (string | undefined)[] = [];

    const left = transaction(
      async () => {
        seen.push((await claim(name, "default", "left"))?.job);
        gate.resolve();
        await done.promise;
      },
      { name },
    );

    await gate.promise;
    const right = transaction(
      async () => {
        seen.push((await claim(name, "default", "right"))?.job);
      },
      { name },
    );
    await right;
    done.resolve();
    await left;

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.every((entry) => entry !== undefined)).toBe(true);
  });
});

describe("complete and fail", () => {
  test("stores json as json, not as a string of json", async () => {
    const [id] = await insert(name, [job({ args: [7, "large"] })]);
    const claimed = await claim(name, "default", "w1");
    await complete(name, id as number, { ok: 1 }, claimed?.lockedBy as string);
    const [row] = (await pool(name).unsafe(
      `select jsonb_typeof(args) as args, jsonb_typeof(output) as output ` +
        `from ${TABLE} where id = $1`,
      [id] as never[],
    )) as unknown as { args: string; output: string }[];
    expect(row).toEqual({ args: "array", output: "object" });
  });

  test("stores the output when the fence matches", async () => {
    const [id] = await insert(name, [job()]);
    const claimed = await claim(name, "default", "w1");
    expect(
      await complete(
        name,
        id as number,
        { ok: 1 },
        claimed?.lockedBy as string,
      ),
    ).toBe("done");
    const row = await byId(name, id as number);
    expect(row.output).toEqual({ ok: 1 });
    expect(row.lockedBy).toBeNull();
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  test("changes nothing when the fence does not match", async () => {
    const [id] = await insert(name, [job()]);
    await claim(name, "default", "w1");
    expect(await complete(name, id as number, 1, "w1:2")).toBeUndefined();
    expect(await fail(name, id as number, "boom", "other:1")).toBeUndefined();
    expect((await byId(name, id as number)).state).toBe("active");
  });

  test("moves to retry and pushes run_at by the flat delay", async () => {
    const [id] = await insert(name, [job({ retryDelay: 30 })]);
    const claimed = await claim(name, "default", "w1");
    expect(
      await fail(name, id as number, "boom", claimed?.lockedBy as string),
    ).toBe("retry");
    const row = await byId(name, id as number);
    const delta = (row.runAt.getTime() - Date.now()) / 1000;
    expect(delta).toBeGreaterThan(25);
    expect(delta).toBeLessThan(35);
    expect(row.error).toBe("boom");
    expect(row.finishedAt).toBeNull();
  });

  test("doubles the delay on each attempt when backoff is on", async () => {
    const [id] = await insert(name, [
      job({ retryDelay: 10, backoff: true, maxAttempts: 4 }),
    ]);
    await fail(
      name,
      id as number,
      "boom",
      (await claim(name, "default", "w1"))?.lockedBy as string,
    );
    const first = (await byId(name, id as number)).runAt.getTime() - Date.now();

    await pool(name).unsafe(`update ${TABLE} set run_at = now()`);
    await fail(
      name,
      id as number,
      "boom",
      (await claim(name, "default", "w1"))?.lockedBy as string,
    );
    const second =
      (await byId(name, id as number)).runAt.getTime() - Date.now();

    expect(first / 1000).toBeGreaterThan(8);
    expect(first / 1000).toBeLessThan(12);
    expect(second / 1000).toBeGreaterThan(18);
    expect(second / 1000).toBeLessThan(22);
  });

  test("fails for good once the attempts run out", async () => {
    const [id] = await insert(name, [job({ maxAttempts: 1 })]);
    const claimed = await claim(name, "default", "w1");
    expect(
      await fail(name, id as number, "boom", claimed?.lockedBy as string),
    ).toBe("failed");
    expect((await byId(name, id as number)).finishedAt).toBeInstanceOf(Date);
  });

  test("discard fails without another attempt", async () => {
    const [id] = await insert(name, [job({ maxAttempts: 9 })]);
    const claimed = await claim(name, "default", "w1");
    expect(
      await discard(name, id as number, "unknown", claimed?.lockedBy as string),
    ).toBe("failed");
    const row = await byId(name, id as number);
    expect(row.attempts).toBe(row.maxAttempts);
  });
});

describe("sweep", () => {
  test("returns a stale active row and leaves a fresh one", async () => {
    const [stale, fresh] = await insert(name, [
      job({ job: "stale", timeout: 1 }),
      job({ job: "fresh", timeout: 900 }),
    ]);
    await claim(name, "default", "w1");
    await claim(name, "default", "w1");
    await pool(name).unsafe(
      `update ${TABLE} set locked_at = now() - interval '10 seconds' ` +
        "where id = $1",
      [stale] as never[],
    );

    expect(await sweep(name)).toEqual([stale]);
    expect((await byId(name, stale as number)).state).toBe("retry");
    expect((await byId(name, stale as number)).error).toBe("timeout");
    expect((await byId(name, fresh as number)).state).toBe("active");
  });
});

describe("retention", () => {
  test("deletes only finished rows past the window", async () => {
    const [done, failed, queued] = await insert(name, [
      job({ job: "done" }),
      job({ job: "failed" }),
      job({ job: "queued" }),
    ]);
    await pool(name).unsafe(
      `update ${TABLE} set state = 'done', ` +
        "finished_at = now() - interval '2 hours' where id = $1",
      [done] as never[],
    );
    await pool(name).unsafe(
      `update ${TABLE} set state = 'failed', finished_at = now() where id = $1`,
      [failed] as never[],
    );

    expect(await purge(name, 3600)).toBe(1);
    expect((await rows(name)).map((row) => row.id)).toEqual([failed, queued]);
  });
});
