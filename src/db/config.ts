import fs from "node:fs";
import path from "node:path";

export type DatabaseOptions = {
  url?: string | undefined;
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  searchPath?: string;
  ssl?: boolean | "require" | "prefer";
};

export type Databases = Record<string, DatabaseOptions>;

const KEY = "__flypathDatabases";

type Holder = { [KEY]?: Databases };

const holder = globalThis as unknown as Holder;

export function configureDatabases(databases: Databases): void {
  holder[KEY] = { ...holder[KEY], ...databases };
}

export function databaseOptions(name: string): DatabaseOptions {
  const declared = holder[KEY]?.[name];
  if (declared) {
    return { ...declared, url: declared.url ?? urlFromEnv(name) };
  }
  return { url: urlFromEnv(name) };
}

function urlFromEnv(name: string): string | undefined {
  if (name === "default") return process.env["DATABASE_URL"];
  const upper = name.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase();
  return process.env[`${upper}_DATABASE_URL`];
}

export function connectionUrl(name: string): string {
  const { url } = databaseOptions(name);
  if (url) return url;
  throw new Error(
    name === "default"
      ? "flypath: no database is configured; set DATABASE_URL in .env"
      : `flypath: the "${name}" database has no url; declare it as ` +
          `flypath({ databases: { ${name}: { url: … } } })`,
  );
}

export function loadEnv(root: string): void {
  const file = path.join(root, ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
