#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cac } from "cac";
import packageJson from "flypath/package.json" with { type: "json" };

import type { Worker, WorkOptions } from "./jobs/worker.ts";
import type { AndroidOptions } from "./native/android.ts";
import type { FlypathOptions } from "./native/config.ts";
import type { IosOptions } from "./native/ios.ts";
import { setVerbose } from "./shared/env.ts";
import { FlypathError } from "./shared/errors.ts";
import type { Row } from "./terminal/output.ts";
import {
  blank,
  fail,
  header,
  intro,
  print,
  success,
  warn,
} from "./terminal/output.ts";
import { duration, mark, paint, plural, relative } from "./terminal/style.ts";

const cli = cac("flypath");

function integer(
  value: string | undefined,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new FlypathError(
      `${name} must be an integer between 1 and ${String(maximum)}`,
    );
  }
  return parsed;
}

const port = (value: string | undefined): number | undefined =>
  integer(value, "--port", 65535);

type CliOptions<T> = Omit<T, "root" | "port"> & { port?: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function environment(): Promise<string> {
  const root = process.cwd();
  const { loadEnv } = await import("./db/config.ts");
  loadEnv(root);
  return root;
}

async function declareOptions(options: FlypathOptions): Promise<void> {
  const { configureDatabases } = await import("./db/config.ts");
  const { configureJobs } = await import("./jobs/config.ts");
  const { configureMail } = await import("./mail/config.ts");
  if (options.databases) configureDatabases(options.databases);
  if (options.jobs) configureJobs(options.jobs);
  if (options.mail) configureMail(options.mail);
}

async function configureApplication(root: string): Promise<void> {
  const { loadOptions } = await import("./native/config.ts");
  await declareOptions(await loadOptions(root));
}

async function declareFromServer(
  server: import("vite").ViteDevServer,
): Promise<void> {
  const { CONFIG_PLUGIN } = await import("./native/config.ts");
  const plugin = server.config.plugins.find(
    (entry) => entry.name === CONFIG_PLUGIN,
  );
  await declareOptions((plugin?.api as FlypathOptions | undefined) ?? {});
}

function untilSignal(worker: Worker): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void worker.stop().then(resolve, reject);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function startDevWorker(
  server: import("vite").ViteDevServer,
): Promise<void> {
  try {
    const { isRunnableDevEnvironment } = await import("vite");
    const environment = server.environments["rsc"];
    if (!environment || !isRunnableDevEnvironment(environment)) return;
    const input = environment.config.build.rolldownOptions.input;
    const source =
      typeof input === "string"
        ? input
        : (input as Record<string, string> | undefined)?.["index"];
    if (source === undefined) return;
    const resolved = await environment.pluginContainer.resolveId(source);
    if (!resolved) return;
    const module = (await environment.runner.import(resolved.id)) as {
      work?: (options?: WorkOptions) => Promise<Worker>;
    };
    if (!module.work) return;
    const worker = await module.work();
    const close = server.close.bind(server);
    server.close = async (): Promise<void> => {
      await worker.stop();
      await close();
    };
  } catch (error) {
    warn("Could not start the job worker", message(error));
  }
}

function writeBuildInfo(
  root: string,
  build: string,
  url: string | undefined,
): void {
  const file = path.join(root, "dist", "build.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ build, url: url ?? null, at: new Date().toISOString() }, null, 2)}\n`,
  );
}

async function publicOrigin(options: FlypathOptions): Promise<string> {
  const { appUrl, ENV } = await import("./shared/env.ts");
  const url = appUrl() ?? options.url;
  if (url === undefined || url === null || url.trim() === "") {
    throw new FlypathError(
      "A release build needs the application's public origin",
      {
        hint:
          'Set url in vite.config.ts (url: "https://example.com"), or ' +
          `${ENV.url} in the environment`,
      },
    );
  }
  return url.trim().replace(/\/+$/, "");
}

async function buildNative(
  root: string,
  options: FlypathOptions,
  platforms: ("ios" | "android")[],
  build: string,
): Promise<void> {
  const { buildNativeRelease } = await import("./native/bundle.ts");
  await buildNativeRelease({
    root,
    platforms,
    url: await publicOrigin(options),
    build,
    outDir: path.join(root, "dist", "native"),
    clientDir: path.join(root, "dist", "client"),
    rscDir: path.join(root, "dist", "rsc"),
  });
}

cli.option("--verbose", "Show everything the tools print");

cli
  .command("dev", "Start the dev server for web and native")
  .option("--port <port>", "Port to listen on")
  .option("--host [host]", "Expose the server on the network")
  .action(async (options: { port?: string; host?: boolean | string }) => {
    const started = performance.now();
    const root = await environment();
    const { createServer } = await import("vite");
    const { terminalLogger } = await import("./terminal/logger.ts");
    const server = await createServer({
      customLogger: terminalLogger(),
      clearScreen: false,
      server: { port: port(options.port), host: options.host },
    });
    await declareFromServer(server);
    await server.listen();

    const p = paint(process.stderr);
    const rows: Row[] = [];
    const local = server.resolvedUrls?.local[0];
    const network = server.resolvedUrls?.network[0];
    if (local !== undefined) {
      rows.push(["Local", p.accent(local.replace(/\/$/, ""))]);
    }
    if (network !== undefined) {
      rows.push(["Network", p.accent(network.replace(/\/$/, ""))]);
    }

    const { databaseUrl } = await import("./shared/env.ts");
    const database = databaseUrl("default") !== undefined;
    let unchecked: string | undefined;
    if (database) {
      const { status } = await import("./migrations/runner.ts");
      try {
        const current = await status(root);
        if (current.pending.length > 0) {
          rows.push([
            "Database",
            `${plural(current.pending.length, "migration")} pending ${p.dim("— run flypath migrate")}`,
          ]);
        }
      } catch (error) {
        unchecked = message(error);
      }
    }

    header("dev", rows);
    if (unchecked !== undefined) {
      warn("Could not check migrations", unchecked);
    }
    success(`Ready in ${duration(performance.now() - started)}`);
    blank();

    if (database) await startDevWorker(server);
  });

cli
  .command("start", "Serve the built application")
  .option("--port <port>", "Port to listen on")
  .option("--host <host>", "Address to bind")
  .action(async (options: { port?: string; host?: string }) => {
    const { start } = await import("./serve/index.ts");
    await start({ port: port(options.port), host: options.host });
  });

cli
  .command("work", "Run background jobs and crons")
  .option("--queues <names>", "Comma separated queues this worker serves")
  .action(async (options: { queues?: string }) => {
    const root = await environment();
    const entry = path.join(root, "dist", "rsc", "index.js");
    const { closePools } = await import("./db/client.ts");
    try {
      const module = (await import(pathToFileURL(entry).href)) as {
        work?: (options?: WorkOptions) => Promise<Worker>;
      };
      if (!module.work) {
        throw new FlypathError(`${relative(entry)} does not export work()`, {
          hint: "Run flypath build",
        });
      }

      const { reporter } = await import("./terminal/format.ts");
      const { globals } = await import("./shared/globals.ts");
      globals().report = reporter();

      const queues = options.queues?.split(",").map((name) => name.trim());
      if (queues?.some((name) => name === ""))
        throw new FlypathError("--queues must contain non-empty queue names");
      const worker = await module.work({ queues });

      const { queue, queueNames } = await import("./jobs/config.ts");
      const { crons } = await import("./jobs/registry.ts");
      const scheduled = crons().length;
      header("work", [
        [
          "Queues",
          (queues ?? queueNames())
            .map((name) => `${name} ×${String(queue(name).concurrency)}`)
            .join(" · "),
        ],
        ...(scheduled === 0 ? [] : [["Crons", String(scheduled)] as const]),
      ]);
      success("Ready");
      blank();
      await untilSignal(worker);
    } finally {
      await closePools();
    }
  });

cli
  .command("build", "Build for production")
  .option(
    "--platform <names>",
    "Platforms: web, ios, android, or all (default: enabled; web always built)",
  )
  .action(async (options: { platform?: string }) => {
    const started = performance.now();
    const { loadOptions } = await import("./native/config.ts");
    const { scaffoldNative } = await import("./native/scaffold.ts");
    const { projectContext } = await import("./native/template.ts");
    const root = await environment();
    const { buildPlatforms } = await import("./native/platforms.ts");
    const platforms = buildPlatforms(root, options.platform);
    const declared = await loadOptions(root);
    if (platforms.length > 0) {
      scaffoldNative(projectContext(root, declared.port, declared));
    }

    const { currentBuildId } = await import("./vite/plugins.ts");
    const build = currentBuildId();

    header("build");

    const { createBuilder } = await import("vite");
    const { terminalLogger } = await import("./terminal/logger.ts");
    const { closePools } = await import("./db/client.ts");
    const logger = terminalLogger({ collect: true });
    const builder = await createBuilder({
      customLogger: logger,
      logLevel: "warn",
      clearScreen: false,
    });
    try {
      await builder.buildApp();
      writeBuildInfo(root, build, declared.url);
      if (platforms.length > 0) {
        await buildNative(root, declared, platforms, build);
      }
    } finally {
      await closePools();
    }

    const warnings = logger.flush();
    blank();
    success(
      `Built in ${duration(performance.now() - started)}`,
      warnings === 0 ? "dist/" : `dist/ · ${plural(warnings, "warning")}`,
    );
  });

cli
  .command("ios", "Build and run the iOS app")
  .option("--device <name>", "Simulator or device name, udid, or serial")
  .option("--host <host>", "Address a device should reach the dev server at")
  .option("--port <port>", "Dev server port")
  .option("--console", "Stay attached to the app's native console")
  .action(async (options: CliOptions<IosOptions>) => {
    header("ios");
    const { runIos } = await import("./native/ios.ts");
    await runIos({ ...options, port: port(options.port) });
  });

cli
  .command("android", "Build and run the Android app")
  .option("--device <serial>", "Emulator or device serial or model")
  .option("--host <host>", "Address a device should reach the dev server at")
  .option("--port <port>", "Dev server port")
  .action(async (options: CliOptions<AndroidOptions>) => {
    header("android");
    const { runAndroid } = await import("./native/android.ts");
    await runAndroid({ ...options, port: port(options.port) });
  });

cli
  .command("release <platform>", "Package a signed iOS or Android app")
  .option("--archive-only", "iOS: stop at the signed archive")
  .option("--upload", "iOS: upload to App Store Connect")
  .option("--apk", "Android: produce an APK instead of an app bundle")
  .action(
    async (
      platform: string,
      options: { archiveOnly?: boolean; upload?: boolean; apk?: boolean },
    ) => {
      if (platform !== "ios" && platform !== "android") {
        throw new FlypathError("Release platform must be ios or android");
      }
      if (platform === "ios" && options.apk !== undefined) {
        throw new FlypathError("--apk is only available for Android");
      }
      if (
        platform === "android" &&
        (options.archiveOnly !== undefined || options.upload !== undefined)
      ) {
        throw new FlypathError(
          "--archive-only and --upload are only available for iOS",
        );
      }
      if (options.archiveOnly && options.upload) {
        throw new FlypathError(
          "Use either --archive-only or --upload, not both",
        );
      }
      header(`release ${platform}`);
      if (platform === "ios") {
        const { releaseIos } = await import("./native/release-ios.ts");
        await releaseIos({
          mode: options.archiveOnly
            ? "archive"
            : options.upload
              ? "upload"
              : "export",
        });
      } else {
        const { releaseAndroid } = await import("./native/release-android.ts");
        await releaseAndroid({ apk: options.apk });
      }
    },
  );

cli
  .command("makemigration", "Write a migration from db/schema.ts")
  .option("--name <name>", "Name for the migration file")
  .option("--empty", "Write an empty migration")
  .option("--check", "Exit 1 if the schema needs a migration; write nothing")
  .option("--no-input", "Never prompt; take the conservative answer")
  .action(
    async (options: {
      name?: string;
      input?: boolean;
      empty?: boolean;
      check?: boolean;
    }) => {
      if (options.check && (options.empty || options.name !== undefined)) {
        throw new FlypathError(
          "--check cannot be combined with --empty or --name",
        );
      }
      if (options.empty && options.input === false) {
        throw new FlypathError(
          "--no-input does not apply to --empty migrations",
        );
      }
      const root = await environment();
      await configureApplication(root);
      const { makemigration, terminalPrompt } =
        await import("./migrations/generate.ts");
      const { conservative } = await import("./migrations/diff.ts");
      const { closePools } = await import("./db/client.ts");
      intro();
      try {
        const result = await makemigration(root, {
          name: options.name,
          empty: options.empty,
          check: options.check,
          prompt: options.input === false ? conservative : terminalPrompt(),
        });

        if (options.check) {
          if (result.operations.length > 0) {
            throw new FlypathError(
              `db/schema.ts has ${plural(result.operations.length, "change")} with no migration`,
              { hint: "Run flypath makemigration" },
            );
          }
          success("db/schema.ts matches the migrations");
          return;
        }
        if (!result.file) {
          success("No changes to write");
          return;
        }
        success(`Wrote ${relative(result.file)}`);
      } finally {
        await closePools();
      }
    },
  );

cli
  .command("migrate", "Apply pending migrations")
  .option("--to <timestamp>", "Stop after this timestamp")
  .option("--database <name>", "Named database")
  .option("--plan", "Print pending migrations and SQL without applying them")
  .option("--status", "List applied and pending migrations")
  .option("--check", "Exit 1 if migrations are pending; apply nothing")
  .action(
    async (options: {
      to?: string;
      database?: string;
      plan?: boolean;
      status?: boolean;
      check?: boolean;
    }) => {
      if (
        [options.plan, options.status, options.check].filter(Boolean).length > 1
      ) {
        throw new FlypathError("Use only one of --plan, --status, or --check");
      }
      if (options.to !== undefined && (options.status || options.check)) {
        throw new FlypathError(
          "--to cannot be combined with --status or --check",
        );
      }
      const root = await environment();
      await configureApplication(root);
      const database = options.database ?? "default";
      const { migrate, migratePlan, status } =
        await import("./migrations/runner.ts");
      const { closePools } = await import("./db/client.ts");

      try {
        if (options.plan) {
          const { statements } = await import("./migrations/ddl.ts");
          const plans = await migratePlan(root, database, options.to);
          for (const plan of plans) {
            console.log(`-- ${plan.file.id}`);
            for (const operation of plan.operations) {
              for (const text of statements(operation)) {
                console.log(`${text};`);
              }
            }
          }
          if (plans.length === 0) console.log("-- nothing pending");
          return;
        }
        if (options.status) {
          const current = await status(root, database);
          const p = paint(process.stderr);
          intro(`${p.bold("Migrations")}  ${database}`);
          const names = [
            ...current.applied.map((entry) => entry.name),
            ...current.pending.map((entry) => entry.file.id),
            ...current.missing,
          ];
          if (names.length === 0) {
            print(p.dim("No migrations yet"));
            return;
          }
          const width = Math.max(...names.map((name) => name.length)) + 4;
          const stream = process.stderr;
          for (const entry of current.applied) {
            print(`${mark("done", stream)} ${entry.name}`);
          }
          for (const entry of current.pending) {
            print(
              `${mark("pending", stream)} ${entry.file.id.padEnd(width)}${p.dim("pending")}`,
            );
          }
          for (const name of current.missing) {
            print(
              `${mark("error", stream)} ${name.padEnd(width)}${p.dim("applied, file missing")}`,
            );
          }
          return;
        }
        if (options.check) {
          const current = await status(root, database);
          if (current.pending.length === 0) return;
          throw new FlypathError(
            `${plural(current.pending.length, "migration")} pending`,
            {
              hint: "Run flypath migrate",
              details: current.pending.map((entry) => entry.file.id),
            },
          );
        }
        intro();
        const done = await migrate(root, {
          database,
          to: options.to,
        });

        const { jobsDatabase } = await import("./jobs/config.ts");
        const { install } = await import("./jobs/schema.ts");
        if (jobsDatabase() === database) await install(database);

        if (done.length === 0) {
          success("Nothing to migrate");
          return;
        }
        for (const file of done) success(`Applied ${file.id}`);
      } finally {
        await closePools();
      }
    },
  );

cli
  .command("rollback", "Reverse applied migrations")
  .option("--step <n>", "How many migrations to reverse")
  .option("--to <timestamp>", "Reverse down to, and excluding, this timestamp")
  .option("--database <name>", "Named database")
  .action(
    async (options: { step?: string; to?: string; database?: string }) => {
      if (options.step !== undefined && options.to !== undefined) {
        throw new FlypathError("Use either --step or --to, not both");
      }
      const step = integer(options.step, "--step");
      const root = await environment();
      await configureApplication(root);
      const { rollback } = await import("./migrations/runner.ts");
      const { closePools } = await import("./db/client.ts");
      intro();
      try {
        const done = await rollback(root, {
          database: options.database ?? "default",
          step,
          to: options.to,
        });
        if (done.length === 0) {
          success("Nothing to roll back");
          return;
        }
        for (const file of done) success(`Reversed ${file.id}`);
      } finally {
        await closePools();
      }
    },
  );

const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["Application", ["dev", "build", "start", "work"]],
  ["Native", ["ios", "android", "release"]],
  ["Database", ["makemigration", "migrate", "rollback"]],
];

function indent(body: string): string {
  return body
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");
}

cli.help((sections) => {
  const p = paint(process.stdout);
  const title = `\n  ${p.bold(p.accent("flypath"))} ${p.dim(packageJson.version)}`;
  const titled = (section: { title?: string; body: string }) => ({
    body:
      section.title === undefined
        ? section.body
        : `  ${p.bold(section.title)}\n${indent(section.body)}`,
  });

  if (!sections.some((section) => section.title === "Commands")) {
    return [
      { body: title },
      ...sections
        .slice(1)
        .filter((section) => !section.title?.startsWith("For more info"))
        .map(titled),
      { body: "" },
    ];
  }

  const width = Math.max(...cli.commands.map((entry) => entry.name.length)) + 4;
  const groups = GROUPS.map(([group, names]) =>
    [
      `  ${p.bold(group)}`,
      ...names.flatMap((name) => {
        const command = cli.commands.find((entry) => entry.name === name);
        return command === undefined
          ? []
          : [`    ${name.padEnd(width)}${p.dim(command.description)}`];
      }),
    ].join("\n"),
  );
  const options = sections.find((section) => section.title === "Options");

  return [
    { body: title },
    { body: `  ${p.bold("Usage")}  flypath <command> [options]` },
    ...groups.map((body) => ({ body })),
    ...(options === undefined ? [] : [titled(options)]),
    { body: `  ${p.dim("Run flypath <command> --help for its options")}\n` },
  ];
});

cli.version(packageJson.version);

try {
  cli.parse(process.argv, { run: false });

  if (cli.matchedCommand) {
    cli.matchedCommand.checkUnknownOptions();
    cli.matchedCommand.checkOptionValue();
    for (const option of [
      ...cli.globalCommand.options,
      ...cli.matchedCommand.options,
    ]) {
      const value: unknown = cli.options[option.name];
      if (value === undefined) continue;
      if (option.isBoolean) {
        if (typeof value !== "boolean")
          throw new FlypathError(`${option.rawName} must be a boolean flag`);
      } else if (typeof value === "string" || typeof value === "number") {
        if (String(value).trim() === "")
          throw new FlypathError(
            `${option.rawName} requires a non-empty value`,
          );
        cli.options[option.name] = String(value);
      } else if (!(option.required === false && value === true)) {
        throw new FlypathError(`${option.rawName} requires a single value`);
      }
    }
    if (cli.options["verbose"] === true) setVerbose();
    const trailing = cli.options["--"] as string[];
    if (cli.args.length > cli.matchedCommand.args.length || trailing.length > 0)
      throw new FlypathError("Unexpected positional arguments");
    if (cli.options["version"] === true) cli.outputVersion();
    else await cli.runMatchedCommand();
  } else if (cli.options["help"] !== true && cli.options["version"] !== true) {
    cli.globalCommand.checkUnknownOptions();
    const [unknown] = cli.args;
    if (unknown === undefined) cli.outputHelp();
    else {
      fail(
        new FlypathError(`Unknown command "${unknown}"`, {
          hint: "Run flypath --help for the list",
        }),
      );
    }
  }
} catch (error) {
  fail(error);
}
