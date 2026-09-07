import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { discover, generate } from "../../src/vite/jobs-scan.ts";

const roots: string[] = [];

const resolver = {
  resolve: async (source: string, importer: string) => {
    const target = path.resolve(path.dirname(importer), source);
    return fs.existsSync(target) ? { id: target } : null;
  },
};

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-scan-"));
  roots.push(root);
  for (const [name, code] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code);
  }
  return root;
}

const ids = async (root: string): Promise<string[]> => {
  const found = await discover(resolver, root);
  return [...found.modules]
    .flatMap(([file, names]) =>
      [...names].map(
        (name) =>
          `${path.relative(root, file).split(path.sep).join("/")}#${name}`,
      ),
    )
    .toSorted();
};

const refuse = async (files: Record<string, string>): Promise<string> => {
  try {
    await discover(resolver, project(files));
  } catch (error) {
    return (error as Error).message;
  }
  return "no error";
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("the scan", () => {
  test("resolves a named import", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\nimport { resize } from "./images.ts";\n' +
        "await jobs().enqueue(() => resize(1));\n",
    });
    expect(await ids(root)).toEqual(["app/images.ts#resize"]);
  });

  test("resolves a renamed import to the exported name", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\nimport { resize as rz } from "./images.ts";\n' +
        "await jobs().enqueue(() => rz(1));\n",
    });
    expect(await ids(root)).toEqual(["app/images.ts#resize"]);
  });

  test("resolves a namespace member", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\nimport * as ns from "./images.ts";\n' +
        "await jobs().enqueue(() => ns.resize(1));\n",
    });
    expect(await ids(root)).toEqual(["app/images.ts#resize"]);
  });

  test("resolves a dynamic import member", async () => {
    const root = project({
      "app/reports.ts": "export async function digest(kind) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\n' +
        'await jobs().enqueue(async () => (await import("./reports.ts")).digest("d"));\n',
    });
    expect(await ids(root)).toEqual(["app/reports.ts#digest"]);
  });

  test("resolves a bare reference and a same-module export", async () => {
    const root = project({
      "app/a.ts":
        'import { jobs } from "flypath";\n' +
        "export async function cleanup() {}\n" +
        "await jobs().enqueue(cleanup);\n",
    });
    expect(await ids(root)).toEqual(["app/a.ts#cleanup"]);
  });

  test("registers the same function once across two sites", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\nimport { resize } from "./images.ts";\n' +
        "await jobs().enqueue(() => resize(1));\n",
      "app/b.ts":
        'import { jobs } from "flypath";\nimport { resize } from "./images.ts";\n' +
        "await jobs().enqueue(() => resize(2));\n",
    });
    expect(await ids(root)).toEqual(["app/images.ts#resize"]);
  });

  test("skips node_modules, dist and the native directories", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "node_modules/x/index.ts":
        'import { jobs } from "flypath";\nawait jobs().enqueue(() => nope(1));\n',
      "dist/rsc/index.ts":
        'import { jobs } from "flypath";\nawait jobs().enqueue(() => nope(1));\n',
      "app/a.ts":
        'import { jobs } from "flypath";\nimport { resize } from "./images.ts";\n' +
        "await jobs().enqueue(() => resize(1));\n",
    });
    expect(await ids(root)).toEqual(["app/images.ts#resize"]);
  });

  test("refuses a target that the module does not export", async () => {
    expect(
      await refuse({
        "app/a.ts":
          'import { jobs } from "flypath";\n' +
          "async function cleanup() {}\n" +
          "await jobs().enqueue(cleanup);\n",
      }),
    ).toMatch(/"cleanup" is not a job[\s\S]*a\.ts:3:22/);
  });

  test("refuses a parameter", async () => {
    expect(
      await refuse({
        "app/a.ts":
          'import { jobs } from "flypath";\n' +
          "export async function run(fn) {\n  await jobs().enqueue(fn);\n}\n",
      }),
    ).toMatch(/"fn" is not a job/);
  });

  test("refuses a method on a plain object", async () => {
    expect(
      await refuse({
        "app/a.ts":
          'import { jobs } from "flypath";\n' +
          "const api = {};\nawait jobs().enqueue(() => api.resize(1));\n",
      }),
    ).toMatch(/"api\.resize" is not a job/);
  });

  test("refuses a callee from node_modules", async () => {
    const root = project({
      "node_modules/left-pad/index.ts": "export function pad() {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\n' +
        'import { pad } from "../node_modules/left-pad/index.ts";\n' +
        "await jobs().enqueue(() => pad());\n",
    });
    await expect(discover(resolver, root)).rejects.toThrow(/node_modules/);
  });

  test('refuses a "use server" module', async () => {
    expect(
      await refuse({
        "app/actions.ts":
          '"use server";\nexport async function notify(id) {}\n',
        "app/a.ts":
          'import { jobs } from "flypath";\nimport { notify } from "./actions.ts";\n' +
          "await jobs().enqueue(() => notify(1));\n",
      }),
    ).toMatch(/"use server" module/);
  });
});

describe("the registry module", () => {
  test("imports every target and registers it under its id", async () => {
    const root = project({
      "app/images.ts": "export async function resize(id) {}\n",
      "app/a.ts":
        'import { jobs } from "flypath";\nimport { resize } from "./images.ts";\n' +
        "await jobs().enqueue(() => resize(1));\n",
    });
    const code = generate(root, await discover(resolver, root), {});
    expect(code).toContain(`import * as m0 from "${root}/app/images.ts"`);
    expect(code).toContain('"app/images.ts#resize": m0["resize"]');
    expect(code).toContain("configureJobs({})");
    expect(code).toContain("}, []);");
  });

  test("re-exports app/crons.ts when it exists", async () => {
    const root = project({
      "app/maintenance.ts": "export async function prune(days) {}\n",
      "app/crons.ts":
        'import { cron } from "flypath";\nimport { prune } from "./maintenance.ts";\n' +
        'export default [cron("0 3 * * *", () => prune(30))];\n',
    });
    const code = generate(root, await discover(resolver, root), {});
    expect(code).toContain(`import crons from "${root}/app/crons.ts"`);
    expect(code).toContain("}, crons);");
    expect(code).toContain('"app/maintenance.ts#prune"');
  });

  test("carries the queue configuration into the module", async () => {
    const root = project({ "app/a.ts": "export const x = 1;\n" });
    const code = generate(root, await discover(resolver, root), {
      queues: { images: { concurrency: 2 } },
    });
    expect(code).toContain(
      'configureJobs({"queues":{"images":{"concurrency":2}}})',
    );
  });
});
