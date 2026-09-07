import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { cron } from "../../src/jobs/enqueue.ts";
import { register, reset } from "../../src/jobs/registry.ts";
import { fire, schedule } from "../../src/jobs/worker.ts";
import { clear, rows, schemaName, setup, teardown } from "./harness.ts";

const name = schemaName();

async function prune(..._args: unknown[]): Promise<void> {}

async function digest(..._args: unknown[]): Promise<void> {}

beforeAll(async () => {
  await setup(name, { queues: { default: {}, nightly: {} } });
});

afterAll(async () => {
  await teardown(name);
});

beforeEach(async () => {
  await clear(name);
  reset();
  register({
    "app/maintenance.ts#prune": prune,
    "app/reports.ts#digest": digest,
  });
});

describe("cron keys", () => {
  test("changes when the expression changes", async () => {
    const [first] = await schedule([cron("0 3 * * *", () => [prune, [30]])]);
    const [second] = await schedule([cron("0 4 * * *", () => [prune, [30]])]);
    expect(first?.key).not.toBe(second?.key);
    expect(first?.key).toMatch(/^app\/maintenance\.ts#prune@0 3 \* \* \*#/);
  });

  test("changes when the arguments change", async () => {
    const [first] = await schedule([cron("0 3 * * *", () => [prune, [30]])]);
    const [second] = await schedule([cron("0 3 * * *", () => [prune, [7]])]);
    expect(first?.key).not.toBe(second?.key);
  });

  test("takes an explicit name when given one", async () => {
    const [entry] = await schedule([
      cron("0 3 * * *", () => [prune, [30]], { name: "nightly-prune" }),
    ]);
    expect(entry?.key).toBe("nightly-prune");
  });

  test("carries the queue and policy onto the row it will write", async () => {
    const [entry] = await schedule([
      cron("0 3 * * *", () => [prune, [30]], {
        queue: "nightly",
        retries: 0,
        timeout: 60,
      }),
    ]);
    expect(entry?.row).toMatchObject({
      queue: "nightly",
      job: "app/maintenance.ts#prune",
      args: [30],
      maxAttempts: 1,
      timeout: 60,
    });
  });
});

describe("cron validation", () => {
  test("refuses an expression croner cannot parse", async () => {
    await expect(schedule([cron("nope", () => [prune, []])])).rejects.toThrow(
      /invalid configuration format/,
    );
  });

  test("refuses a timezone that does not exist", async () => {
    await expect(
      schedule([
        cron("0 3 * * *", () => [prune, []], { timezone: "Not/AZone" }),
      ]),
    ).rejects.toThrow(/Not\/AZone/);
  });

  test("keeps the local hour across a DST boundary", async () => {
    const [entry] = await schedule([
      cron("0 3 * * *", () => [prune, []], { timezone: "Europe/Lisbon" }),
    ]);
    const local = (at: Date): string =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        minute: "2-digit",
      }).format(at);

    const winter = entry?.cron.nextRun(new Date("2026-03-20T00:00:00Z"));
    const summer = entry?.cron.nextRun(new Date("2026-04-20T00:00:00Z"));
    expect(local(winter as Date)).toBe("03:00");
    expect(local(summer as Date)).toBe("03:00");
    expect(winter?.getTime()).not.toBe(summer?.getTime());
  });
});

describe("firing a minute", () => {
  test("collapses two tickers on the same minute to one row", async () => {
    const scheduled = await schedule([cron("* * * * *", () => [prune, [30]])]);
    await Promise.all([
      fire(name, scheduled),
      fire(name, scheduled),
      fire(name, scheduled),
    ]);
    const written = await rows(name);
    expect(written).toHaveLength(1);
    expect(written[0]?.job).toBe("app/maintenance.ts#prune");
    expect(written[0]?.cronKey).toBe(scheduled[0]?.key);
    expect(written[0]?.cronAt?.getSeconds()).toBe(0);
  });

  test("writes nothing for a minute the schedule does not cover", async () => {
    const at = new Date();
    const hour = (at.getUTCHours() + 5) % 24;
    const scheduled = await schedule([
      cron(`0 ${String(hour)} 1 1 *`, () => [prune, [30]]),
    ]);
    await fire(name, scheduled);
    expect(await rows(name)).toEqual([]);
  });

  test("writes one row per due entry", async () => {
    const scheduled = await schedule([
      cron("* * * * *", () => [prune, [30]]),
      cron("* * * * *", () => [digest, ["daily"]]),
    ]);
    await fire(name, scheduled);
    expect((await rows(name)).map((row) => row.job).toSorted()).toEqual([
      "app/maintenance.ts#prune",
      "app/reports.ts#digest",
    ]);
  });
});
