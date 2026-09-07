import { describe, expect, test } from "vitest";

import { rewriteJobs } from "../../src/vite/jobs.ts";

const header = 'import { cron, jobs } from "flypath";\n';

const rewrite = (body: string, prelude = header): string | undefined =>
  rewriteJobs("/app/a.ts", `${prelude}${body}`)?.code.slice(prelude.length);

describe("the rewrite", () => {
  test("turns a call into its callee and its arguments", () => {
    expect(rewrite("jobs().enqueue(() => resize(a, b));\n")).toBe(
      "jobs().enqueue(() => [resize, [a, b]]);\n",
    );
  });

  test("keeps a namespaced callee whole", () => {
    expect(rewrite("jobs().enqueue(() => ns.resize(a));\n")).toBe(
      "jobs().enqueue(() => [ns.resize, [a]]);\n",
    );
  });

  test("keeps a dynamic import in the callee position", () => {
    expect(
      rewrite(
        'jobs().enqueue(async () => (await import("./r.ts")).digest("d"));\n',
      ),
    ).toBe(
      'jobs().enqueue(async () => [(await import("./r.ts")).digest, ["d"]]);\n',
    );
  });

  test("drops an await in front of the call", () => {
    expect(rewrite("jobs().enqueue(async () => await resize(1));\n")).toBe(
      "jobs().enqueue(async () => [resize, [1]]);\n",
    );
  });

  test("leaves a bare reference alone", () => {
    expect(rewrite("jobs().enqueue(cleanup);\n")).toBeUndefined();
  });

  test("rewrites every thunk of a bulk enqueue", () => {
    expect(rewrite("jobs().enqueue(() => resize(1), () => resize(2));\n")).toBe(
      "jobs().enqueue(() => [resize, [1]], () => [resize, [2]]);\n",
    );
  });

  test("copies spreads and captured variables verbatim", () => {
    expect(rewrite("jobs().enqueue(() => resize(...ids, post.id));\n")).toBe(
      "jobs().enqueue(() => [resize, [...ids, post.id]]);\n",
    );
  });

  test("takes a call with no arguments", () => {
    expect(rewrite("jobs().enqueue(() => cleanup());\n")).toBe(
      "jobs().enqueue(() => [cleanup, []]);\n",
    );
  });

  test("follows a handle bound to jobs() in the same file", () => {
    expect(
      rewrite('const q = jobs({ queue: "images" });\nq.enqueue(() => r(1));\n'),
    ).toBe(
      'const q = jobs({ queue: "images" });\nq.enqueue(() => [r, [1]]);\n',
    );
  });

  test("follows jobs imported under another name", () => {
    const prelude = 'import { jobs as queue } from "flypath";\n';
    expect(rewrite("queue().enqueue(() => resize(1));\n", prelude)).toBe(
      "queue().enqueue(() => [resize, [1]]);\n",
    );
  });

  test("rewrites the second argument of cron", () => {
    expect(
      rewrite('export default [cron("0 3 * * *", () => prune(30))];\n'),
    ).toBe('export default [cron("0 3 * * *", () => [prune, [30]])];\n');
  });

  test("leaves an unrelated .enqueue( alone", () => {
    expect(rewrite("other.enqueue(() => resize(1));\n")).toBeUndefined();
  });

  test("leaves a file that never imports jobs alone", () => {
    expect(
      rewriteJobs("/app/a.ts", "queue().enqueue(() => resize(1));\n"),
    ).toBeUndefined();
  });

  test("maps the rewritten span back to the source", () => {
    const result = rewriteJobs(
      "/app/a.ts",
      `${header}jobs().enqueue(() => resize(1));\n`,
    );
    expect(result?.map.sources).toEqual(["/app/a.ts"]);
    expect(result?.map.mappings).not.toBe("");
  });
});

describe("the rewrite's refusals", () => {
  const at = (body: string): string => {
    try {
      rewrite(body);
    } catch (error) {
      return (error as Error).message;
    }
    return "no error";
  };

  test("refuses a block body", () => {
    expect(at("jobs().enqueue(() => {\n  resize(1);\n});\n")).toMatch(
      /expression body[\s\S]*at \/app\/a\.ts:2:22/,
    );
  });

  test("refuses a call inside an argument", () => {
    expect(at("jobs().enqueue(() => a(b(c)));\n")).toMatch(
      /another call as an argument[\s\S]*at \/app\/a\.ts:2:24/,
    );
  });

  test("refuses a conditional body", () => {
    expect(at("jobs().enqueue(() => x ? a() : b());\n")).toMatch(
      /exactly one call[\s\S]*at \/app\/a\.ts:2:22/,
    );
  });

  test("refuses a thunk that is not an arrow", () => {
    expect(at("jobs().enqueue(function () { return a(); });\n")).toMatch(
      /arrow literal[\s\S]*at \/app\/a\.ts:2:16/,
    );
  });
});
