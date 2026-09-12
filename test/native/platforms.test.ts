import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import {
  buildPlatforms,
  enabledNativePlatforms,
} from "../../src/native/platforms.ts";
import { scaffoldNative } from "../../src/native/scaffold.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-platforms-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("web-only projects need no native platforms", () => {
  expect(buildPlatforms(root)).toEqual([]);
  expect(buildPlatforms(root, "all")).toEqual([]);
  expect(buildPlatforms(root, "web")).toEqual([]);
});

test("only platform directories enable native builds", () => {
  fs.writeFileSync(path.join(root, "apple"), "");
  fs.mkdirSync(path.join(root, "android"));
  expect(enabledNativePlatforms(root)).toEqual(["android"]);
  expect(buildPlatforms(root, "all")).toEqual(["android"]);
  expect(buildPlatforms(root, "web")).toEqual([]);
  expect(buildPlatforms(root, "native,android")).toEqual(["android"]);
  expect(() => buildPlatforms(root, "ios")).toThrow(
    'Platform "ios" is not enabled',
  );
});

test("both native platforms can be built or selected independently", () => {
  fs.mkdirSync(path.join(root, "apple"));
  fs.mkdirSync(path.join(root, "android"));
  expect(buildPlatforms(root)).toEqual(["ios", "android"]);
  expect(buildPlatforms(root, "ios")).toEqual(["ios"]);
  expect(buildPlatforms(root, "android")).toEqual(["android"]);
  expect(() => buildPlatforms(root, "invalid")).toThrow(
    'Unknown platform "invalid"',
  );
});

test.each([[], ["apple"], ["android"], ["apple", "android"]])(
  "native module generation respects enabled directories: %j",
  (...directories: string[]) => {
    fs.mkdirSync(path.join(root, "app"));
    fs.writeFileSync(
      path.join(root, "app", "camera.ts"),
      '"use native";\nexport declare function open(): void;\n',
    );
    for (const directory of directories)
      fs.mkdirSync(path.join(root, directory));
    const manifest = scaffoldNative({ root, projectName: "Test" });
    expect(manifest.modules).toHaveLength(1);
    expect(fs.existsSync(path.join(root, "apple"))).toBe(
      directories.includes("apple"),
    );
    expect(fs.existsSync(path.join(root, "android"))).toBe(
      directories.includes("android"),
    );
    expect(
      fs.existsSync(path.join(root, "apple", "Sources", "generated")),
    ).toBe(directories.includes("apple"));
    expect(
      fs.existsSync(
        path.join(
          root,
          "android",
          "src",
          "main",
          "kotlin",
          "generated",
          "FlypathGenerated.kt",
        ),
      ),
    ).toBe(directories.includes("android"));
  },
);
