import { beforeEach, describe, expect, test } from "vitest";

import { resolveThunk } from "../../src/jobs/enqueue.ts";
import { register, reset } from "../../src/jobs/registry.ts";

async function resize(..._args: unknown[]): Promise<void> {}

async function cleanup(): Promise<void> {}

beforeEach(() => {
  reset();
  register({ "app/images.ts#resize": resize, "app/a.ts#cleanup": cleanup });
});

describe("the thunk contract", () => {
  test("reads a rewritten call", async () => {
    expect(await resolveThunk(() => [resize, [1, "hello"]])).toEqual({
      id: "app/images.ts#resize",
      args: [1, "hello"],
    });
  });

  test("reads an async thunk that resolves its callee", async () => {
    const module = await Promise.resolve({ resize });
    expect(
      await resolveThunk(async () => [
        (await Promise.resolve(module)).resize,
        ["d"],
      ]),
    ).toEqual({ id: "app/images.ts#resize", args: ["d"] });
  });

  test("takes a bare reference as a call with no arguments", async () => {
    expect(await resolveThunk(cleanup)).toEqual({
      id: "app/a.ts#cleanup",
      args: [],
    });
  });

  test("evaluates captured variables and spreads at enqueue time", async () => {
    let counter = 0;
    const next = (): number => (counter += 1);
    const ids = [7, 8];
    const first = await resolveThunk(() => [resize, [next(), ...ids]]);
    const second = await resolveThunk(() => [resize, [next(), ...ids]]);
    expect(first.args).toEqual([1, 7, 8]);
    expect(second.args).toEqual([2, 7, 8]);
  });

  test("refuses a function the scan never saw", async () => {
    async function stranger(): Promise<void> {}
    await expect(resolveThunk(() => [stranger, []])).rejects.toThrow(
      /stranger is not a job/,
    );
  });

  test("refuses a thunk that produces something else", async () => {
    await expect(resolveThunk(() => 42)).rejects.toThrow(/is not a job/);
  });
});
