#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cac } from "cac";

import type { Worker, WorkOptions } from "./jobs/worker.ts";
import type { FlypathOptions } from "./native/config.ts";
import { setVerbose } from "./shared/env.ts";
import { FlypathError } from "./shared/errors.ts";
import type { Row } from "./terminal/output.ts";
import {
  blank,
  fail,
  flypathVersion,
  header,
  intro,
  print,
  success,
  warn,
} from "./terminal/output.ts";
import { duration, mark, paint, plural, relative } from "./terminal/style.ts";

if (process.argv.includes("--verbose")) setVerbose();

const cli = cac("flypath");

const port = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function guard<A extends unknown[]>(
  run: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args) => {
    try {
      await run(...args);
    } catch (error) {
      fail(error);
    }
  };
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

async function declareDatabases(root: string): Promise<void> {
  const { loadOptions } = await import("./native/config.ts");
  try {
    await declareOptions(await loadOptions(root));
  } catch (error) {
    warn("Could not read vite.config.ts", message(error));
  }
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
  return new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void worker.stop().then(resolve, resolve);
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

function parsePlatforms(value: string | undefined): ("ios" | "android")[] {
  if (value === undefined) return [];
  const wanted = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  const out: ("ios" | "android")[] = [];
  for (const entry of wanted) {
    if (entry === "ios" || entry === "android") out.push(entry);
    else if (entry === "all" || entry === "native") out.push("ios", "android");
    else {
      throw new FlypathError(`Unknown platform "${entry}"`, {
        hint: "Use ios, android, or all",
      });
    }
  }
  return [...new Set(out)];
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

export type BuildInfo = { build: string; url: string | null };

function readBuildInfo(root: string): BuildInfo | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, "dist", "build.json"), "utf8"),
    ) as BuildInfo;
  } catch {
    return undefined;
  }
}

async function publicOrigin(
  options: FlypathOptions,
  root: string,
): Promise<string> {
  const { appUrl, ENV } = await import("./shared/env.ts");
  const url = appUrl() ?? options.url ?? readBuildInfo(root)?.url;
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
    url: await publicOrigin(options, root),
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
  .action(
    guard(async (options: { port?: string; host?: boolean | string }) => {
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
    }),
  );

cli
  .command("start", "Serve the built application")
  .option("--port <port>", "Port to listen on")
  .option("--host <host>", "Address to bind")
  .option("--cluster <n>", "Worker count; 0 or off for a single process")
  .action(
    guard(
      async (options: {
        port?: string;
        host?: string;
        cluster?: string | number;
      }) => {
        const { start } = await import("./serve/index.ts");
        await start({
          port: port(options.port),
          host: options.host,
          cluster:
            options.cluster === undefined ? undefined : String(options.cluster),
        });
      },
    ),
  );

cli
  .command("work", "Run background jobs and crons")
  .option("--queues <names>", "Comma separated queues this worker serves")
  .option("--concurrency <n>", "Override every queue's concurrency")
  .action(
    guard(async (options: { queues?: string; concurrency?: string }) => {
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
        const concurrency =
          options.concurrency === undefined
            ? undefined
            : Number(options.concurrency);
        const worker = await module.work({
          ...(queues === undefined ? {} : { queues }),
          ...(concurrency === undefined ? {} : { concurrency }),
        });

        const { queue, queueNames } = await import("./jobs/config.ts");
        const { crons } = await import("./jobs/registry.ts");
        const scheduled = crons().length;
        header("work", [
          [
            "Queues",
            (queues ?? queueNames())
              .map(
                (name) =>
                  `${name} ×${String(concurrency ?? queue(name).concurrency)}`,
              )
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
    }),
  );

cli
  .command("build", "Build for production")
  .option("--platform <names>", "Also build native bundles: ios, android")
  .action(
    guard(async (options: { platform?: string }) => {
      const started = performance.now();
      const { loadOptions } = await import("./native/config.ts");
      const { scaffoldNative } = await import("./native/scaffold.ts");
      const { projectContext } = await import("./native/template.ts");
      const root = await environment();
      let declared: FlypathOptions = {};
      try {
        const loaded = await loadOptions(root);
        declared = loaded;
        scaffoldNative(projectContext(root, loaded.port, loaded));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("react-native")
        ) {
          throw error;
        }
      }

      const platforms = parsePlatforms(options.platform);
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
    }),
  );

cli
  .command("ios", "Build and launch the iOS app")
  .option("--device <name>", "Simulator or device name, udid, or serial")
  .option("--host <host>", "Address a device should reach the dev server at")
  .option("--port <port>", "Dev server port")
  .option("--console", "Stay attached to the app's native console")
  .option("--release", "Archive and export a signed build")
  .option("--archive-only", "Stop at the .xcarchive")
  .option("--upload", "Hand the export to App Store Connect")
  .option("--xcode", "Open the project in Xcode as well")
  .action(
    guard(
      async (options: {
        device?: string;
        host?: string;
        port?: string;
        console?: boolean;
        release?: boolean;
        archiveOnly?: boolean;
        upload?: boolean;
        xcode?: boolean;
      }) => {
        header(options.release === true ? "ios --release" : "ios");
        const { runIos } = await import("./native/ios.ts");
        await runIos({
          device: options.device,
          host: options.host,
          port: port(options.port),
          console: options.console,
          release: options.release,
          archiveOnly: options.archiveOnly,
          upload: options.upload,
          xcode: options.xcode,
        });
      },
    ),
  );

cli
  .command("android", "Build and launch the Android app")
  .option("--device <serial>", "Emulator or device serial or model")
  .option("--host <host>", "Address a device should reach the dev server at")
  .option("--port <port>", "Dev server port")
  .option("--release", "Build a signed .aab")
  .option("--apk", "Build a signed .apk instead of an .aab")
  .option("--studio", "Open the project in Android Studio as well")
  .action(
    guard(
      async (options: {
        device?: string;
        host?: string;
        port?: string;
        release?: boolean;
        apk?: boolean;
        studio?: boolean;
      }) => {
        header(options.release === true ? "android --release" : "android");
        const { runAndroid } = await import("./native/android.ts");
        await runAndroid({
          device: options.device,
          host: options.host,
          port: port(options.port),
          release: options.release,
          apk: options.apk,
          studio: options.studio,
        });
      },
    ),
  );

cli
  .command("makemigration", "Write a migration from db/schema.ts")
  .option("--name <name>", "Name for the migration file")
  .option("--check", "Exit 1 if a migration is missing, write nothing")
  .option("--empty", "Write a migration with no operations")
  .option("--no-input", "Never prompt; take the conservative answer")
  .action(
    guard(
      async (options: {
        name?: string;
        check?: boolean;
        empty?: boolean;
        input?: boolean;
      }) => {
        const root = await environment();
        await declareDatabases(root);
        const { makemigration, terminalPrompt } =
          await import("./migrations/generate.ts");
        const { conservative } = await import("./migrations/diff.ts");
        const { closePools } = await import("./db/client.ts");
        intro();
        try {
          const result = await makemigration(root, {
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.check === undefined ? {} : { check: options.check }),
            ...(options.empty === undefined ? {} : { empty: options.empty }),
            prompt: options.input === false ? conservative : terminalPrompt(),
          });

          if (options.check) {
            if (result.operations.length === 0) {
              success("db/schema.ts matches the migrations");
              return;
            }
            throw new FlypathError(
              `db/schema.ts has ${plural(result.operations.length, "change")} with no migration`,
              { hint: "Run flypath makemigration" },
            );
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
    ),
  );

cli
  .command("migrate", "Apply pending migrations")
  .option("--to <timestamp>", "Stop after this timestamp")
  .option("--plan", "Print what would run")
  .option("--sql", "Print the SQL each migration would run")
  .option("--status", "List applied and pending migrations")
  .option("--check", "Exit 1 if anything is pending")
  .option("--database <name>", "Named database")
  .action(
    guard(
      async (options: {
        to?: string;
        plan?: boolean;
        sql?: boolean;
        status?: boolean;
        check?: boolean;
        database?: string;
      }) => {
        const root = await environment();
        await declareDatabases(root);
        const database = options.database ?? "default";
        const { migrate, migratePlan, status } =
          await import("./migrations/runner.ts");
        const { closePools } = await import("./db/client.ts");

        try {
          if (options.plan || options.sql) {
            const { statements } = await import("./migrations/ddl.ts");
            const plans = await migratePlan(root, database, options.to);
            for (const plan of plans) {
              console.log(`-- ${plan.file.id}`);
              if (!options.sql) continue;
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
            ...(options.to === undefined ? {} : { to: options.to }),
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
    ),
  );

cli
  .command("rollback", "Reverse applied migrations")
  .option("--step <n>", "How many migrations to reverse")
  .option("--to <timestamp>", "Reverse down to, and excluding, this timestamp")
  .option("--database <name>", "Named database")
  .action(
    guard(
      async (options: { step?: string; to?: string; database?: string }) => {
        const root = await environment();
        await declareDatabases(root);
        const { rollback } = await import("./migrations/runner.ts");
        const { closePools } = await import("./db/client.ts");
        intro();
        try {
          const done = await rollback(root, {
            database: options.database ?? "default",
            ...(options.step === undefined
              ? {}
              : { step: Number(options.step) }),
            ...(options.to === undefined ? {} : { to: options.to }),
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
    ),
  );

const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["Develop", ["dev", "ios", "android"]],
  ["Ship", ["build", "start", "work"]],
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
  const title = `\n  ${p.bold(p.accent("flypath"))} ${p.dim(flypathVersion())}`;
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

cli.version(flypathVersion());

cli.parse(process.argv, { run: false });

if (cli.matchedCommand) {
  void cli.runMatchedCommand();
} else if (cli.options["help"] !== true && cli.options["version"] !== true) {
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
