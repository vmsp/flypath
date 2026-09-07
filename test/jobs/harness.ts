import { closePools, pool } from "../../src/db/client.ts";
import { configureDatabases } from "../../src/db/config.ts";
import type { JobsOptions } from "../../src/jobs/config.ts";
import { configureJobs } from "../../src/jobs/config.ts";
import type { NewJob } from "../../src/jobs/schema.ts";
import { install, TABLE, toRow } from "../../src/jobs/schema.ts";
import type { JobRow } from "../../src/jobs/schema.ts";

const url =
  process.env["TEST_DATABASE_URL"] ?? "postgres://localhost/flypath_test";

export function schemaName(): string {
  return `flypath_jobs_${Math.random().toString(36).slice(2, 10)}`;
}

export async function setup(
  name: string,
  options: JobsOptions = {},
): Promise<void> {
  configureDatabases({ [name]: { url, searchPath: name, max: 10 } });
  configureJobs({ ...options, database: name });
  await pool(name).unsafe(`create schema if not exists ${name}`);
  await install(name);
}

export async function teardown(name: string): Promise<void> {
  await pool(name).unsafe(`drop schema if exists ${name} cascade`);
  await closePools();
}

export function job(overrides: Partial<NewJob> = {}): NewJob {
  return {
    queue: "default",
    job: "app/jobs.ts#noop",
    args: [],
    key: null,
    priority: 0,
    runAt: new Date(),
    maxAttempts: 3,
    retryDelay: 0,
    backoff: false,
    timeout: 900,
    ...overrides,
  };
}

export async function rows(name: string): Promise<JobRow[]> {
  const raw = (await pool(name).unsafe(
    `select * from ${TABLE} order by id`,
  )) as unknown as Record<string, unknown>[];
  return raw.map(toRow);
}

export async function byId(name: string, id: number): Promise<JobRow> {
  const raw = (await pool(name).unsafe(`select * from ${TABLE} where id = $1`, [
    id,
  ] as never[])) as unknown as Record<string, unknown>[];
  return toRow(raw[0] as Record<string, unknown>);
}

export async function clear(name: string): Promise<void> {
  await pool(name).unsafe(`delete from ${TABLE}`);
}
