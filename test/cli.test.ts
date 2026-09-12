import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  runIos: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  runAndroid: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  releaseIos: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  releaseAndroid: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  makemigration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  migrate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  migratePlan: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  status: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  rollback: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  loadOptions: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  closePools: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../src/native/ios.ts", () => ({ runIos: calls.runIos }));
vi.mock("../src/native/android.ts", () => ({ runAndroid: calls.runAndroid }));
vi.mock("../src/native/release-ios.ts", () => ({
  releaseIos: calls.releaseIos,
}));
vi.mock("../src/native/release-android.ts", () => ({
  releaseAndroid: calls.releaseAndroid,
}));
vi.mock("../src/native/config.ts", () => ({ loadOptions: calls.loadOptions }));
vi.mock("../src/db/config.ts", () => ({
  loadEnv: vi.fn<() => void>(),
  configureDatabases: vi.fn<() => void>(),
}));
vi.mock("../src/db/client.ts", () => ({ closePools: calls.closePools }));
vi.mock("../src/migrations/generate.ts", () => ({
  makemigration: calls.makemigration,
  terminalPrompt: vi.fn<() => void>(),
}));
vi.mock("../src/migrations/runner.ts", () => ({
  migrate: calls.migrate,
  migratePlan: calls.migratePlan,
  status: calls.status,
  rollback: calls.rollback,
}));
vi.mock("../src/jobs/schema.ts", () => ({ install: vi.fn<() => void>() }));
vi.mock("../src/terminal/output.ts", () => ({
  blank: vi.fn<() => void>(),
  header: vi.fn<() => void>(),
  intro: vi.fn<() => void>(),
  print: vi.fn<() => void>(),
  success: vi.fn<() => void>(),
  warn: vi.fn<() => void>(),
  fail: (error: unknown) => {
    throw error;
  },
}));

const argv = process.argv;

async function run(...args: string[]): Promise<void> {
  process.argv = [process.execPath, "flypath", ...args];
  await import("../src/cli.ts");
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  calls.loadOptions.mockResolvedValue({});
  calls.makemigration.mockResolvedValue({ operations: [] });
  calls.migrate.mockResolvedValue([]);
  calls.rollback.mockResolvedValue([]);
  calls.migratePlan.mockResolvedValue([]);
  calls.status.mockResolvedValue({ applied: [], pending: [], missing: [] });
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
});

describe("command options", () => {
  it.each([
    ["ios", "--release"],
    ["ios", "--upload"],
    ["ios", "--xcode"],
    ["android", "--apk"],
    ["android", "--studio"],
    ["release", "ios", "--device", "phone"],
    ["release", "android", "--port", "3000"],
    ["start", "--cluster", "2"],
    ["work", "--concurrency", "2"],
    ["migrate", "--sql"],
    ["--invalid"],
  ])("rejects removed or unrelated options: %s %s", async (...args) => {
    await expect(run(...args)).rejects.toThrow(/Unknown option/);
    expect(calls.runIos).not.toHaveBeenCalled();
    expect(calls.releaseIos).not.toHaveBeenCalled();
    expect(calls.migrate).not.toHaveBeenCalled();
  });

  it.each([
    ["ios", "extra"],
    ["ios", "--", "extra"],
    ["ios", "--port", "bad"],
    ["ios", "--port", "65536"],
    ["ios", "--port", "1.5"],
    ["ios", "--port"],
    ["ios", "--device="],
    ["ios", "--device", "a", "--device", "b"],
    ["rollback", "--step", "0"],
    ["rollback", "--step", "1", "--to", "20260101000000"],
  ])(
    "rejects invalid arguments before performing work: %s %s",
    async (...args) => {
      await expect(run(...args)).rejects.toThrow(
        /Unexpected|must be|missing|requires|Use either/,
      );
      expect(calls.runIos).not.toHaveBeenCalled();
      expect(calls.rollback).not.toHaveBeenCalled();
      expect(calls.loadOptions).not.toHaveBeenCalled();
    },
  );
});

it.each([
  [[], "export"],
  [["--archive-only"], "archive"],
  [["--upload"], "upload"],
])("dispatches iOS release options %s", async (args, mode) => {
  await run("release", "ios", ...args);
  expect(calls.releaseIos).toHaveBeenCalledWith({ mode });
  expect(calls.runIos).not.toHaveBeenCalled();
});

it.each([
  ["release", "ios", "--apk"],
  ["release", "android", "--archive-only"],
  ["release", "android", "--upload"],
  ["release", "ios", "--archive-only", "--upload"],
  ["release", "web"],
  ["release"],
  ["release", "ios", "extra"],
  ["migrate", "--plan", "--check"],
  ["migrate", "--status", "--check"],
  ["migrate", "--plan", "--status"],
  ["migrate", "--status", "--to", "20260101000000"],
  ["migrate", "--check", "--to", "20260101000000"],
  ["makemigration", "--check", "--empty"],
  ["makemigration", "--check", "--name", "test"],
  ["makemigration", "--empty", "--no-input"],
])("rejects incompatible modes: %s %s", async (...args) => {
  await expect(run(...args)).rejects.toThrow(
    /only|Use|must|missing|Unexpected|cannot|does not apply/,
  );
  expect(calls.releaseIos).not.toHaveBeenCalled();
  expect(calls.releaseAndroid).not.toHaveBeenCalled();
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.makemigration).not.toHaveBeenCalled();
});

it("passes development options with a numeric port", async () => {
  await run("ios", "--device", "phone", "--port", "4321", "--console");
  expect(calls.runIos).toHaveBeenCalledWith(
    expect.objectContaining({ device: "phone", port: 4321, console: true }),
  );
});

it("builds an APK through the release command", async () => {
  await run("release", "android", "--apk");
  expect(calls.releaseAndroid).toHaveBeenCalledWith(
    expect.objectContaining({ apk: true }),
  );
});

it("prints SQL without applying migrations", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  calls.migratePlan.mockResolvedValue([
    {
      file: { id: "20260101000000_test" },
      operations: [{ kind: "sql", up: "SELECT 1", down: "SELECT 2" }],
    },
  ]);
  await run("migrate", "--plan", "--to", "20260101000000");
  expect(calls.migratePlan).toHaveBeenCalledWith(
    process.cwd(),
    "default",
    "20260101000000",
  );
  expect(log).toHaveBeenCalledWith("-- 20260101000000_test");
  expect(log).toHaveBeenCalledWith("SELECT 1;");
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.closePools).toHaveBeenCalled();
});

it("checks the schema without writing a migration", async () => {
  await run("makemigration", "--check");
  expect(calls.makemigration).toHaveBeenCalledWith(
    process.cwd(),
    expect.objectContaining({ check: true }),
  );
});

it("fails when migrations are pending without applying them", async () => {
  calls.status.mockResolvedValue({ pending: [{ file: { id: "pending" } }] });
  await expect(run("migrate", "--check")).rejects.toThrow(
    "1 migration pending",
  );
  expect(calls.migrate).not.toHaveBeenCalled();
  expect(calls.closePools).toHaveBeenCalled();
});

it("stops on configuration errors", async () => {
  calls.loadOptions.mockRejectedValue(new Error("Broken configuration"));
  await expect(run("migrate")).rejects.toThrow("Broken configuration");
  expect(calls.migrate).not.toHaveBeenCalled();
});

it("creates an empty migration with its requested name", async () => {
  await run("makemigration", "--empty", "--name", "backfill");
  expect(calls.makemigration).toHaveBeenCalledWith(
    process.cwd(),
    expect.objectContaining({ empty: true, name: "backfill" }),
  );
});

it("shows migration status without applying migrations", async () => {
  await run("migrate", "--status", "--database", "analytics");
  expect(calls.status).toHaveBeenCalledWith(process.cwd(), "analytics");
  expect(calls.migrate).not.toHaveBeenCalled();
});

it("applies migrations when no inspection mode is selected", async () => {
  await run("migrate");
  expect(calls.migrate).toHaveBeenCalledWith(process.cwd(), {
    database: "default",
    to: undefined,
  });
});

it("defaults Android releases to an app bundle", async () => {
  await run("release", "android");
  expect(calls.releaseAndroid).toHaveBeenCalledWith({ apk: undefined });
});
