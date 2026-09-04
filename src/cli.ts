#!/usr/bin/env node
import { cac } from "cac";

const cli = cac("flypath");

const port = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value);

async function environment(): Promise<string> {
  const root = process.cwd();
  const { loadEnv } = await import("./db/config.ts");
  loadEnv(root);
  return root;
}

async function declareDatabases(root: string): Promise<void> {
  const { loadOptions } = await import("./native/config.ts");
  const { configureDatabases } = await import("./db/config.ts");
  try {
    const options = await loadOptions(root);
    if (options.databases) configureDatabases(options.databases);
  } catch {
    // A project without a resolvable vite config still gets DATABASE_URL.
  }
}

function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

cli
  .command("dev", "Start the dev server (web, flight payloads, native bundles)")
  .option("--port <port>", "Port to listen on")
  .option("--host [host]", "Expose the server on the network")
  .action(async (options: { port?: string; host?: boolean | string }) => {
    const root = await environment();
    const { createServer } = await import("vite");
    const server = await createServer({
      server: { port: port(options.port), host: options.host },
    });
    await server.listen();
    server.printUrls();

    if (process.env["DATABASE_URL"]) {
      const { status } = await import("./migrations/runner.ts");
      try {
        const current = await status(root);
        if (current.pending.length > 0) {
          console.warn(
            `flypath: ${String(current.pending.length)} migration(s) pending — ` +
              `${current.pending.map((entry) => entry.file.id).join(", ")}; ` +
              "run flypath migrate",
          );
        }
      } catch (error) {
        console.warn(
          `flypath: could not check migrations — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

cli.command("build", "Build for production").action(async () => {
  const { loadOptions } = await import("./native/config.ts");
  const { scaffoldNative } = await import("./native/scaffold.ts");
  const { projectContext } = await import("./native/template.ts");
  const root = await environment();
  try {
    const options = await loadOptions(root);
    scaffoldNative(projectContext(root, options.port, options));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("react-native")) {
      throw error;
    }
  }

  const { createBuilder } = await import("vite");
  const builder = await createBuilder();
  await builder.buildApp();
});

cli
  .command("ios", "Build and launch the iOS shell")
  .option("--device <name>", "Simulator device name")
  .option("--port <port>", "Dev server port")
  .action(async (options: { device?: string; port?: string }) => {
    const { runIos } = await import("./native/ios.ts");
    await runIos({ device: options.device, port: port(options.port) });
  });

cli
  .command("android", "Build and launch the Android shell")
  .option("--port <port>", "Dev server port")
  .action(async (options: { port?: string }) => {
    const { runAndroid } = await import("./native/android.ts");
    await runAndroid({ port: port(options.port) });
  });

cli
  .command("makemigration", "Write a migration from db/schema.ts")
  .option("--name <name>", "Name for the migration file")
  .option("--check", "Exit 1 if a migration is missing, write nothing")
  .option("--empty", "Write a migration with no operations")
  .option("--no-input", "Never prompt; take the conservative answer")
  .action(
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
      try {
        const result = await makemigration(root, {
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.check === undefined ? {} : { check: options.check }),
          ...(options.empty === undefined ? {} : { empty: options.empty }),
          prompt: options.input === false ? conservative : terminalPrompt(),
        });

        if (options.check) {
          if (result.operations.length === 0) {
            console.log("flypath: db/schema.ts matches the migrations");
            return;
          }
          console.error(
            `flypath: ${String(result.operations.length)} change(s) have no ` +
              "migration; run flypath makemigration",
          );
          process.exit(1);
        }

        if (!result.file) {
          console.log("flypath: no changes to write");
          return;
        }
        console.log(`flypath: wrote ${result.file}`);
      } catch (error) {
        fail(error);
      } finally {
        const { closePools } = await import("./db/client.ts");
        const { closeLoader } = await import("./migrations/files.ts");
        await closeLoader();
        await closePools();
      }
    },
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
        if (options.status) {
          const current = await status(root, database);
          for (const entry of current.applied) {
            console.log(`up      ${entry.name}`);
          }
          for (const entry of current.pending) {
            console.log(`pending ${entry.file.id}`);
          }
          for (const name of current.missing) {
            console.log(`NO FILE ${name}`);
          }
          return;
        }

        if (options.check) {
          const current = await status(root, database);
          if (current.pending.length === 0) return;
          console.error(
            `flypath: ${String(current.pending.length)} migration(s) pending`,
          );
          process.exit(1);
        }

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

        const done = await migrate(root, {
          database,
          ...(options.to === undefined ? {} : { to: options.to }),
        });
        if (done.length === 0) {
          console.log("flypath: nothing to migrate");
          return;
        }
        for (const file of done) console.log(`flypath: applied ${file.id}`);
      } catch (error) {
        fail(error);
      } finally {
        const { closeLoader } = await import("./migrations/files.ts");
        await closeLoader();
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
      const root = await environment();
      await declareDatabases(root);
      const { rollback } = await import("./migrations/runner.ts");
      const { closePools } = await import("./db/client.ts");
      try {
        const done = await rollback(root, {
          database: options.database ?? "default",
          ...(options.step === undefined ? {} : { step: Number(options.step) }),
          ...(options.to === undefined ? {} : { to: options.to }),
        });
        if (done.length === 0) {
          console.log("flypath: nothing to roll back");
          return;
        }
        for (const file of done) console.log(`flypath: reversed ${file.id}`);
      } catch (error) {
        fail(error);
      } finally {
        const { closeLoader } = await import("./migrations/files.ts");
        await closeLoader();
        await closePools();
      }
    },
  );

cli.help();
cli.version("0.0.0");
cli.parse();
