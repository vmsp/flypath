import fs from "node:fs";
import path from "node:path";

import type { ViteDevServer } from "vite";

import type { Migration } from "./operations.ts";

type Runner = { import: (id: string) => Promise<unknown> };

let server: ViteDevServer | undefined;

let runner: Runner | undefined;

async function moduleRunner(): Promise<Runner> {
  if (runner) return runner;
  const { createServer, createServerModuleRunner } = await import("vite");
  server = await createServer({
    logLevel: "warn",
    server: { middlewareMode: true, watch: null },
    environments: {
      ssr: {
        resolve: {
          conditions: ["react-server"],
          externalConditions: ["react-server"],
          noExternal: ["flypath"],
        },
      },
    },
  });
  runner = createServerModuleRunner(server.environments["ssr"] as never);
  return runner;
}

export async function closeLoader(): Promise<void> {
  runner = undefined;
  const open = server;
  server = undefined;
  if (open) await open.close();
}

export type MigrationFile = {
  timestamp: string;
  name: string;
  id: string;
  file: string;
};

const PATTERN = /^(\d{14})_(.+)\.ts$/;

function migrationsDir(root: string): string {
  return path.join(root, "db", "migrations");
}

export function schemaFile(root: string): string {
  return path.join(root, "db", "schema.ts");
}

export function discover(root: string): MigrationFile[] {
  const dir = migrationsDir(root);
  if (!fs.existsSync(dir)) return [];

  const files: MigrationFile[] = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const match = PATTERN.exec(entry);
    if (!match) continue;
    files.push({
      timestamp: match[1] as string,
      name: match[2] as string,
      id: entry.slice(0, -3),
      file: path.join(dir, entry),
    });
  }

  const seen = new Map<string, string>();
  for (const file of files) {
    const previous = seen.get(file.timestamp);
    if (previous !== undefined) {
      throw new Error(
        `flypath: two migrations share the timestamp ${file.timestamp} — ` +
          `${previous} and ${file.id}; rename one of them`,
      );
    }
    seen.set(file.timestamp, file.id);
  }

  files.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return files;
}

export async function importModule(
  file: string,
): Promise<Record<string, unknown>> {
  const target = await moduleRunner();
  return (await target.import(file)) as Record<string, unknown>;
}

async function loadMigration(file: string): Promise<Migration> {
  const module = await importModule(file);
  const value = module["default"];
  if (typeof value !== "object" || value === null || !("operations" in value)) {
    throw new Error(
      `flypath: ${path.basename(file)} has no default export; a migration ` +
        "file ends with export default migration([…])",
    );
  }
  return value as Migration;
}

export async function loadAll(
  files: readonly MigrationFile[],
): Promise<{ file: MigrationFile; migration: Migration }[]> {
  const loaded: { file: MigrationFile; migration: Migration }[] = [];
  for (const file of files) {
    loaded.push({ file, migration: await loadMigration(file.file) });
  }
  return loaded;
}

export function writeMigration(
  root: string,
  id: string,
  source: string,
): string {
  const dir = migrationsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.ts`);
  fs.writeFileSync(file, source);
  return file;
}
