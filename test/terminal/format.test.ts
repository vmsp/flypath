import { describe, expect, test } from "vitest";

import type { Event } from "../../src/shared/events.ts";
import { format } from "../../src/terminal/format.ts";
import { duration, plural, size } from "../../src/terminal/style.ts";
import { FakeStream, plainTerminal } from "./harness.ts";

plainTerminal();

const stream = new FakeStream(false);

function request(overrides: Partial<Extract<Event, { kind: "request" }>>) {
  return format(
    {
      kind: "request",
      method: "GET",
      path: "/",
      status: 200,
      platform: "web",
      ms: 41,
      ...overrides,
    },
    stream,
  );
}

describe("request lines", () => {
  test("columns line up across methods, paths and actions", () => {
    const lines = [
      request({}),
      request({ path: "/about", ms: 6 }),
      request({
        method: "POST",
        path: "/post/12",
        action: "like",
        status: 303,
        platform: "ios",
        ms: 18,
        location: "/post/12",
      }),
    ];
    const at = lines.map((line) => /\d{3} {2}/.exec(line)?.index);
    expect(new Set(at).size).toBe(1);
    const ms = lines.map((line) => line.indexOf("ms"));
    expect(new Set(ms).size).toBe(1);
  });

  test("names the action and the redirect", () => {
    const line = request({
      method: "POST",
      path: "/post/12",
      action: "like",
      status: 303,
      location: "/post/12",
    });
    expect(line).toContain("/post/12  like()");
    expect(line).toContain("→ /post/12");
  });

  test("production lines leave out names", () => {
    const line = format(
      {
        kind: "request",
        method: "POST",
        path: "/login",
        status: 500,
        platform: "android",
        ms: 4,
        action: "login",
        prerendered: true,
      },
      stream,
      { names: false },
    );
    expect(line).not.toContain("login()");
    expect(line).not.toContain("prerendered");
    expect(line).toContain("android");
  });

  test("no color under NO_COLOR, color under FORCE_COLOR", () => {
    expect(request({ status: 500 })).not.toMatch(/\[/);
    process.env["FORCE_COLOR"] = "1";
    expect(request({ status: 500 })).toMatch(/\[/);
  });
});

describe("job lines", () => {
  test("a finished job", () => {
    const line = format(
      {
        kind: "job",
        job: "sendWelcome",
        state: "done",
        ms: 120,
        attempt: 1,
        attempts: 3,
      },
      stream,
    );
    expect(line).toMatch(/^job {2}sendWelcome +done +120ms$/);
  });

  test("a retry says when and why", () => {
    const line = format(
      {
        kind: "job",
        job: "sendDigest",
        state: "retry",
        ms: 30,
        attempt: 2,
        attempts: 5,
        retryIn: 10_000,
        error: "SMTP timeout\n    at x",
      },
      stream,
    );
    expect(line).toMatch(/retry 2\/5 +in 10\.0s +SMTP timeout$/);
  });

  test("request and job names share a column", () => {
    const job = format(
      {
        kind: "job",
        job: "sendWelcome",
        state: "done",
        ms: 120,
        attempt: 1,
        attempts: 1,
      },
      stream,
    );
    const line = request({});
    expect(job.indexOf("done")).toBe(line.indexOf("200"));
  });
});

describe("device lines", () => {
  test("tagged with the platform and marked by level", () => {
    const log = format(
      { kind: "device", platform: "ios", level: "log", text: "fetching feed" },
      stream,
    );
    const warning = format(
      { kind: "device", platform: "ios", level: "warn", text: "no key" },
      stream,
    );
    const error = format(
      { kind: "device", platform: "android", level: "error", text: "boom" },
      stream,
    );
    expect(log).toBe("ios  fetching feed");
    expect(warning).toBe("ios  ! no key");
    expect(error).toBe("android  ✗ boom");
  });
});

describe("change lines", () => {
  test("paths are relative to the project", () => {
    expect(
      format({ kind: "change", file: `${process.cwd()}/app/feed.tsx` }, stream),
    ).toBe("↻ app/feed.tsx");
  });
});

describe("numbers", () => {
  test("durations", () => {
    expect(duration(38)).toBe("38ms");
    expect(duration(1400)).toBe("1.4s");
    expect(duration(52_140)).toBe("52.1s");
    expect(duration(72_000)).toBe("1m 12s");
  });

  test("sizes", () => {
    expect(size(512)).toBe("512 B");
    expect(size(33_000)).toBe("33.0 kB");
    expect(size(812_000)).toBe("812 kB");
    expect(size(24_100_000)).toBe("24.1 MB");
  });

  test("plurals", () => {
    expect(plural(1, "page")).toBe("1 page");
    expect(plural(12, "page")).toBe("12 pages");
  });
});
