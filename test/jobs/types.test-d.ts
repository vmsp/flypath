import { describe, expectTypeOf, test } from "vitest";

import { cron, jobs } from "../../src/jobs/enqueue.ts";

async function resize(_id: number, _width: string): Promise<void> {}

async function cleanup(): Promise<number> {
  return 1;
}

describe("enqueue", () => {
  test("checks the call inside the arrow against the signature", () => {
    jobs().enqueue(() => resize(1, "large"));
    // @ts-expect-error the second argument is a string
    jobs().enqueue(() => resize(1, 2));
    // @ts-expect-error resize takes two arguments
    jobs().enqueue(() => resize(1));
  });

  test("takes a bare reference only when it needs no arguments", () => {
    jobs().enqueue(cleanup);
    // @ts-expect-error resize cannot be called with no arguments
    jobs().enqueue(resize);
  });

  test("returns one id for one thunk and an array for several", () => {
    expectTypeOf(jobs().enqueue(() => cleanup())).toEqualTypeOf<
      Promise<number | null>
    >();
    expectTypeOf(
      jobs().enqueue(
        () => cleanup(),
        () => resize(1, "large"),
      ),
    ).toEqualTypeOf<Promise<(number | null)[]>>();
  });

  test("takes the documented options", () => {
    jobs({ queue: "images", priority: 10, unique: true }).enqueue(cleanup);
    jobs({ delay: 30, retries: 5, backoff: true, timeout: 600 }).enqueue(
      cleanup,
    );
    // @ts-expect-error there is no such option
    jobs({ nope: 1 }).enqueue(cleanup);
  });
});

describe("cron", () => {
  test("takes an expression, a thunk and cron options", () => {
    cron("0 7 * * *", () => resize(1, "large"), {
      timezone: "Europe/Lisbon",
      name: "daily",
    });
    // @ts-expect-error a cron has no delay
    cron("0 7 * * *", cleanup, { delay: 5 });
  });
});
