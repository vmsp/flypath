import { describe, expect, test } from "vitest";

import { FlypathError } from "../../src/shared/errors.ts";
import {
  printError,
  step,
  setStream,
  warn,
} from "../../src/terminal/output.ts";
import { FakeStream, plainTerminal } from "./harness.ts";

plainTerminal();

describe("step", () => {
  test("off a TTY it prints only the settled line", async () => {
    const stream = new FakeStream(false);
    setStream(stream);
    const value = await step("Built server", async (progress) => {
      progress.status("Compiling a.ts");
      progress.summary("149 modules");
      return 7;
    });
    expect(value).toBe(7);
    expect(stream.text()).not.toContain("\r");
    expect(stream.text()).not.toContain("Compiling");
    expect(stream.lines()).toHaveLength(1);
    expect(stream.lines()[0]).toMatch(
      /^ {2}✓ Built server +\d+ms +149 modules$/,
    );
  });

  test("the settled label can differ from the live one", async () => {
    const stream = new FakeStream(false);
    setStream(stream);
    await step(
      { active: "Building for iPhone", done: "Built for iPhone" },
      async () => {},
      { time: false },
    );
    expect(stream.lines()).toEqual(["  ✓ Built for iPhone"]);
  });

  test("on a TTY a foreign write clears and redraws the live line", async () => {
    const stream = new FakeStream(true);
    const original = stream.write;
    setStream(stream);
    await step("Building", async (progress) => {
      progress.status("Linking");
      stream.chunks.length = 0;
      stream.write("foreign\n");
      const at = stream.chunks.indexOf("foreign\n");
      expect(at).toBeGreaterThan(-1);
      expect(stream.chunks.slice(0, at).join("")).toContain("\r\u001B[2K");
      expect(stream.chunks.slice(at + 1).join("")).toContain("Building");
      expect(stream.chunks.slice(at + 1).join("")).toContain("Linking");
    });
    expect(stream.write).toBe(original);
    expect(stream.text()).toContain("✓ Building");
  });

  test("a terminal that reports no width still shows the status", async () => {
    const stream = new FakeStream(true);
    stream.columns = 0;
    setStream(stream);
    await step("Building", async (progress) => {
      progress.status("Linking");
      stream.write("foreign\n");
      expect(stream.text()).toContain("Linking");
    });
  });

  test("a failing step settles into ✗ and rethrows", async () => {
    const stream = new FakeStream(false);
    setStream(stream);
    const error = new FlypathError("No simulator is available", {
      hint: "Boot one in Xcode",
    });
    await expect(
      step({ active: "Building", done: "Built", failed: "Build failed" }, () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error);
    expect(stream.lines()).toEqual([
      "  ✗ Build failed",
      "    No simulator is available",
      "    Boot one in Xcode",
    ]);
  });
});

describe("errors", () => {
  test("a FlypathError is expected: message, hint, details, no stack", () => {
    const stream = new FakeStream(false);
    setStream(stream);
    printError(
      new FlypathError("No target named Nexus", {
        hint: "Pass --device with one of these",
        details: ["Pixel 9  (simulator, emulator-5554)"],
      }),
    );
    const text = stream.text();
    expect(stream.lines()).toEqual([
      "  ✗ No target named Nexus",
      "    Pass --device with one of these",
      "    Pixel 9  (simulator, emulator-5554)",
    ]);
    expect(text).not.toContain(" at ");
  });

  test("any other error keeps its name and a trimmed stack", () => {
    const stream = new FakeStream(false);
    setStream(stream);
    printError(new TypeError("Content-Type was not one of the two"));
    const lines = stream.lines();
    expect(lines[0]).toBe("  ✗ TypeError: Content-Type was not one of the two");
    expect(lines.slice(1).some((line) => line.trim().startsWith("at "))).toBe(
      true,
    );
    expect(stream.text()).not.toContain("node:internal");
    expect(stream.text()).not.toContain(`${process.cwd()}/`);
  });
});

describe("stacks", () => {
  test("a stack with nothing from the project points at --verbose", () => {
    const stream = new FakeStream(false);
    setStream(stream);
    const error = new Error("invalid server reference");
    error.stack = [
      "Error: invalid server reference",
      "    at load (file:///x/node_modules/vite/dist/node.js:1:1)",
      "    at async run (node:internal/process/task_queues:95:5)",
    ].join("\n");
    printError(error);
    expect(stream.lines()).toEqual([
      "  ✗ invalid server reference",
      "    --verbose for the full stack",
    ]);
  });

  test("--verbose keeps every frame", () => {
    const stream = new FakeStream(false);
    setStream(stream);
    process.env["FLYPATH_VERBOSE"] = "1";
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      "    at load (file:///x/node_modules/vite/dist/node.js:1:1)",
    ].join("\n");
    printError(error);
    expect(stream.lines()).toEqual([
      "  ✗ boom",
      "      at load (/x/node_modules/vite/dist/node.js:1:1)",
    ]);
  });
});

describe("warn", () => {
  test("headline, then the hint dim and indented", () => {
    const stream = new FakeStream(false);
    setStream(stream);
    warn("Nothing is listening on http://localhost:8081", "Run flypath dev");
    expect(stream.lines()).toEqual([
      "  ! Nothing is listening on http://localhost:8081",
      "    Run flypath dev",
    ]);
  });
});
