import fs from "node:fs";
import path from "node:path";

import { databaseUrl } from "../shared/env.ts";
import { globals } from "../shared/globals.ts";

export type DatabaseOptions = {
  url?: string | undefined;
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  searchPath?: string;
  ssl?: boolean | "require" | "prefer";
};

export type Databases = Record<string, DatabaseOptions>;

export function configureDatabases(databases: Databases): void {
  const state = globals();
  state.databases = { ...state.databases, ...databases };
}

export function databaseOptions(name: string): DatabaseOptions {
  const declared = globals().databases?.[name];
  if (declared) {
    return { ...declared, url: declared.url ?? databaseUrl(name) };
  }
  return { url: databaseUrl(name) };
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
