import { describe, expect, test } from "vitest";

import { terminalLogger } from "../../src/terminal/logger.ts";
import { setStream } from "../../src/terminal/output.ts";
import { FakeStream, plainTerminal } from "./harness.ts";

plainTerminal();

function setup(collect = false) {
  const stream = new FakeStream(false);
  setStream(stream);
  return { stream, logger: terminalLogger({ collect }) };
}

describe("hidden", () => {
  test("Vite's info chatter", () => {
    const { stream, logger } = setup();
    logger.info("[2m(rsc)[22m connected.", { timestamp: true });
    logger.info("Re-optimizing dependencies because vite config has changed", {
      timestamp: true,
    });
    logger.info("hmr update /app/feed.tsx");
    expect(stream.text()).toBe("");
  });

  test("warnings about files under node_modules", () => {
    const { stream, logger } = setup();
    logger.warnOnce(
      'Sourcemap for "/x/node_modules/react-devtools-core/dist/backend.js" points to missing source files',
    );
    expect(stream.text()).toBe("");
  });
});

describe("shown", () => {
  test("a warning in the project", () => {
    const { stream, logger } = setup();
    logger.warn("app/feed.tsx: unused import");
    logger.warnOnce("app/feed.tsx: unused import");
    logger.warnOnce("app/feed.tsx: unused import");
    expect(stream.lines()).toEqual([
      "  ! app/feed.tsx: unused import",
      "  ! app/feed.tsx: unused import",
    ]);
  });

  test("error(msg, { error }) prints a block from the error", () => {
    const { stream, logger } = setup();
    const error = new TypeError("boom");
    logger.error("[31mInternal server error: boom[39m", {
      error,
    });
    expect(stream.lines()[0]).toBe("  ✗ TypeError: boom");
    expect(logger.hasErrorLogged(error)).toBe(true);
    logger.error("again", { error });
    expect(stream.lines().filter((line) => line.includes("✗"))).toHaveLength(1);
  });

  test("a restart names the file that caused it", () => {
    const { stream, logger } = setup();
    logger.info("vite.config.ts changed, restarting server...");
    logger.info("server restarted.");
    expect(stream.lines()).toEqual(["  ↻ Restarted — vite.config.ts changed"]);
  });
});

describe("build", () => {
  test("warnings wait for flush, dependency warnings are counted", () => {
    const { stream, logger } = setup(true);
    logger.warn("app/a.ts: this is odd");
    logger.warn("node_modules/x/index.js: so is this");
    logger.warn("node_modules/y/index.js: and this");
    expect(stream.text()).toBe("");
    expect(logger.flush()).toBe(1);
    expect(stream.lines()).toEqual([
      "  ! app/a.ts: this is odd",
      "    2 more from dependencies — --verbose to list them",
    ]);
  });

  test("verbose passes everything through", () => {
    const { stream, logger } = setup();
    process.env["FLYPATH_VERBOSE"] = "1";
    logger.info("(ssr) connected.");
    expect(stream.lines()).toEqual(["  (ssr) connected."]);
  });
});
