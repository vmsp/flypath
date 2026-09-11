import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, test, vi } from "vitest";

import { styles } from "../../src/vite/styles.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-styles-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function harness() {
  const plugin = styles(root)[0]!;
  const send = vi.fn<() => void>();
  if (
    typeof plugin.configResolved !== "function" ||
    typeof plugin.configureServer !== "function"
  )
    throw new Error("Missing setup hooks");
  plugin.configResolved.call({} as never, { root } as never);
  plugin.configureServer.call(
    {} as never,
    { environments: {}, hot: { send } } as never,
  );
  return {
    send,
    transform(file: string, code: string, environment = "client") {
      if (typeof plugin.transform !== "function")
        throw new Error("Missing transform hook");
      return plugin.transform.call(
        { environment: { name: environment } } as never,
        code,
        path.join(root, file),
      );
    },
    change(file: string, event: "update" | "delete") {
      if (typeof plugin.watchChange !== "function")
        throw new Error("Missing watch hook");
      return plugin.watchChange.call({} as never, path.join(root, file), {
        event,
      });
    },
    read() {
      if (typeof plugin.load !== "function")
        throw new Error("Missing load hook");
      return plugin.load.call({} as never, "\0virtual:flypath/styles.css");
    },
  };
}

function source(color: string) {
  return `export default <div style={{ color: { default: "${color}" } }} />;`;
}

test("replaces a module's rules and removes styles that disappear", async () => {
  const app = harness();
  await app.transform("page.tsx", source("red"));
  expect(await app.read()).toContain("color: red");
  await app.transform("page.tsx", source("blue"));
  expect(await app.read()).not.toContain("color: red");
  expect(await app.read()).toContain("color: blue");
  await app.transform("page.tsx", "export default <div />;");
  expect(await app.read()).not.toContain("color: blue");
});

test("deduplicates shared rules and retains them until their last owner is deleted", async () => {
  const app = harness();
  await app.transform("one.tsx", source("red"));
  await app.transform("two.tsx", source("red"));
  expect(String(await app.read()).match(/color: red/g)).toHaveLength(1);
  await app.change("one.tsx", "delete");
  expect(await app.read()).toContain("color: red");
  await app.change("two.tsx", "delete");
  expect(await app.read()).not.toContain("color: red");
  expect(app.send).toHaveBeenCalled();
});

test("retains environment variants and clears all of them on a source change", async () => {
  const app = harness();
  await app.transform("page.tsx", source("red"), "client");
  await app.transform("page.tsx", source("blue"), "rsc");
  expect(await app.read()).toContain("color: red");
  expect(await app.read()).toContain("color: blue");
  await app.change("page.tsx", "update");
  await app.transform("page.tsx", source("green"), "rsc");
  const css = await app.read();
  expect(css).not.toContain("color: red");
  expect(css).not.toContain("color: blue");
  expect(css).toContain("color: green");
});

test("does not send another stylesheet update for an unchanged transform", async () => {
  const app = harness();
  await app.transform("page.tsx", source("red"));
  app.send.mockClear();
  await app.transform("page.tsx", source("red"));
  expect(app.send).not.toHaveBeenCalled();
});
