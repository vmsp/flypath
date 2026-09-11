import fs from "node:fs";
import path from "node:path";

import { databaseUrl } from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
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
  throw name === "default"
    ? new FlypathError("No database is configured", {
        hint: "Set DATABASE_URL in .env",
      })
    : new FlypathError(`The "${name}" database has no url`, {
        hint: `Declare it as flypath({ databases: { ${name}: { url: … } } })`,
      });
}

export function loadEnv(root: string): void {
  const file = path.join(root, ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
