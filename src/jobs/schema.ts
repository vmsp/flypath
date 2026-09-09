import { connection, pool } from "../db/client.ts";
import { LOCK_KEY } from "../migrations/lock.ts";

export const TABLE = "flypath_jobs";

export type JobState = "queued" | "active" | "retry" | "done" | "failed";

export type JobRow = {
  id: number;
  queue: string;
  job: string;
  args: unknown[];
  key: string | null;
  priority: number;
  state: JobState;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  retryDelay: number;
  backoff: boolean;
  timeout: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  error: string | null;
  output: unknown;
  cronKey: string | null;
  cronAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type NewJob = {
  queue: string;
  job: string;
  args: unknown[];
  key: string | null;
  priority: number;
  runAt: Date;
  maxAttempts: number;
  retryDelay: number;
  backoff: boolean;
  timeout: number;
};

// TODO: Perhaps it'd be more practical to have the jobs schema use our
// migration system.

const DDL: readonly string[] = [
  `create table if not exists ${TABLE} (
  id           bigint generated always as identity primary key,
  queue        text not null,
  job          text not null,
  args         jsonb not null default '[]',
  key          text,
  priority     integer not null default 0,
  state        text not null default 'queued',
  run_at       timestamptz not null default now(),
  attempts     integer not null default 0,
  max_attempts integer not null,
  retry_delay  integer not null,
  backoff      boolean not null,
  timeout      integer not null,
  locked_at    timestamptz,
  locked_by    text,
  error        text,
  output       jsonb,
  cron_key     text,
  cron_at      timestamptz,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check (state in ('queued', 'active', 'retry', 'done', 'failed'))
)`,
  `create index if not exists ${TABLE}_claim on ${TABLE} ` +
    "(queue, priority desc, run_at, id) where state in ('queued', 'retry')",
  `create unique index if not exists ${TABLE}_key on ${TABLE} ` +
    "(key) where state in ('queued', 'retry')",
  `create unique index if not exists ${TABLE}_cron on ${TABLE} ` +
    "(cron_key, cron_at)",
  `create index if not exists ${TABLE}_active on ${TABLE} ` +
    "(locked_at) where state = 'active'",
  `create index if not exists ${TABLE}_finished on ${TABLE} ` +
    "(finished_at) where state in ('done', 'failed')",
];

export async function install(database: string): Promise<void> {
  const client = await pool(database).reserve();
  try {
    await client.unsafe(`select pg_advisory_lock(${LOCK_KEY.toString()})`);
    try {
      for (const text of DDL) await client.unsafe(text);
    } finally {
      await client.unsafe(`select pg_advisory_unlock(${LOCK_KEY.toString()})`);
    }
  } finally {
    client.release();
  }
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function toRow(raw: Record<string, unknown>): JobRow {
  return {
    id: raw["id"] as number,
    queue: raw["queue"] as string,
    job: raw["job"] as string,
    args: (json(raw["args"]) ?? []) as unknown[],
    key: raw["key"] as string | null,
    priority: raw["priority"] as number,
    state: raw["state"] as JobState,
    runAt: raw["run_at"] as Date,
    attempts: raw["attempts"] as number,
    maxAttempts: raw["max_attempts"] as number,
    retryDelay: raw["retry_delay"] as number,
    backoff: raw["backoff"] as boolean,
    timeout: raw["timeout"] as number,
    lockedAt: raw["locked_at"] as Date | null,
    lockedBy: raw["locked_by"] as string | null,
    error: raw["error"] as string | null,
    output: json(raw["output"]),
    cronKey: raw["cron_key"] as string | null,
    cronAt: raw["cron_at"] as Date | null,
    createdAt: raw["created_at"] as Date,
    finishedAt: raw["finished_at"] as Date | null,
  };
}

const RETRY = `state = case when attempts >= max_attempts then 'failed' else 'retry' end,
  finished_at = case when attempts >= max_attempts then now() end,
  run_at = now() + make_interval(secs => case
    when backoff then retry_delay * power(2, attempts - 1)
    else retry_delay end),
  locked_at = null, locked_by = null`;

const CLAIM = `update ${TABLE}
set state = 'active', locked_at = now(),
    locked_by = $2 || ':' || (attempts + 1)::text,
    attempts = attempts + 1
where id = (
  select id from ${TABLE}
  where queue = $1 and state in ('queued', 'retry') and run_at <= now()
  order by priority desc, run_at, id
  limit 1 for update skip locked
)
returning *`;

const COMPLETE = `update ${TABLE}
set state = 'done', finished_at = now(), output = $2::text::jsonb,
    locked_at = null, locked_by = null
where id = $1 and state = 'active' and locked_by = $3
returning state`;

const FAIL = `update ${TABLE}
set ${RETRY}, error = $2
where id = $1 and state = 'active' and locked_by = $3
returning state`;

const DISCARD = `update ${TABLE}
set state = 'failed', attempts = max_attempts, finished_at = now(), error = $2,
    locked_at = null, locked_by = null
where id = $1 and state = 'active' and locked_by = $3
returning state`;

const SWEEP = `update ${TABLE}
set ${RETRY}, error = 'timeout'
where state = 'active' and locked_at + make_interval(secs => timeout) < now()
returning id`;

const PURGE = `delete from ${TABLE}
where state in ('done', 'failed')
  and finished_at < now() - make_interval(secs => $1::float8)`;

const COLUMNS =
  "queue, job, args, key, priority, run_at, max_attempts, retry_delay, " +
  "backoff, timeout";

const CASTS = [
  "",
  "",
  "::text::jsonb",
  "::text",
  "::int",
  "::timestamptz",
  "::int",
  "::int",
  "::bool",
  "::int",
];

function values(
  rows: readonly NewJob[],
  extra: readonly string[] = [],
): string {
  const casts = [...CASTS, ...extra];
  return rows
    .map((_, index) => {
      const slots = casts.map(
        (cast, at) => `$${String(index * casts.length + at + 1)}${cast}`,
      );
      return `(${slots.join(", ")})`;
    })
    .join(", ");
}

function params(row: NewJob): unknown[] {
  return [
    row.queue,
    row.job,
    JSON.stringify(row.args),
    row.key,
    row.priority,
    row.runAt,
    row.maxAttempts,
    row.retryDelay,
    row.backoff,
    row.timeout,
  ];
}

export async function claim(
  database: string,
  queue: string,
  worker: string,
): Promise<JobRow | undefined> {
  const rows = (await connection(database).unsafe(CLAIM, [
    queue,
    worker,
  ])) as unknown as Record<string, unknown>[];
  const first = rows[0];
  return first === undefined ? undefined : toRow(first);
}

export async function insert(
  database: string,
  rows: readonly NewJob[],
): Promise<(number | null)[]> {
  if (rows.length === 0) return [];
  const text = `insert into ${TABLE} (${COLUMNS})
values ${values(rows)}
on conflict (key) where state in ('queued', 'retry') do nothing
returning id, key`;
  const returned = (await connection(database).unsafe(
    text,
    rows.flatMap(params) as never[],
  )) as unknown as { id: number; key: string | null }[];

  const byKey = new Map<string, number>();
  const plain: number[] = [];
  for (const row of returned) {
    if (row.key === null) plain.push(row.id);
    else byKey.set(row.key, row.id);
  }
  plain.sort((left, right) => left - right);

  let next = 0;
  return rows.map((row) => {
    if (row.key !== null) return byKey.get(row.key) ?? null;
    const id = plain[next];
    next += 1;
    return id ?? null;
  });
}

export async function insertCron(
  database: string,
  row: NewJob,
  cronKey: string,
  cronAt: Date,
): Promise<number | null> {
  const text = `insert into ${TABLE} (${COLUMNS}, cron_key, cron_at)
values ${values([row], ["::text", "::timestamptz"])}
on conflict do nothing
returning id`;
  const returned = (await connection(database).unsafe(text, [
    ...params(row),
    cronKey,
    cronAt,
  ] as never[])) as unknown as { id: number }[];
  return returned[0]?.id ?? null;
}

export async function notify(database: string, queue: string): Promise<void> {
  await connection(database).unsafe("select pg_notify('flypath_jobs', $1)", [
    queue,
  ]);
}

async function settle(
  database: string,
  text: string,
  args: unknown[],
): Promise<JobState | undefined> {
  const rows = (await connection(database).unsafe(
    text,
    args as never[],
  )) as unknown as { state: JobState }[];
  return rows[0]?.state;
}

export async function complete(
  database: string,
  id: number,
  output: unknown,
  worker: string,
): Promise<JobState | undefined> {
  return settle(database, COMPLETE, [
    id,
    output === undefined ? null : JSON.stringify(output),
    worker,
  ]);
}

export async function fail(
  database: string,
  id: number,
  error: string,
  worker: string,
): Promise<JobState | undefined> {
  return settle(database, FAIL, [id, error, worker]);
}

export async function discard(
  database: string,
  id: number,
  error: string,
  worker: string,
): Promise<JobState | undefined> {
  return settle(database, DISCARD, [id, error, worker]);
}

export async function sweep(database: string): Promise<number[]> {
  const rows = (await connection(database).unsafe(SWEEP)) as unknown as {
    id: number;
  }[];
  return rows.map((row) => row.id);
}

export async function purge(
  database: string,
  seconds: number,
): Promise<number> {
  const result = (await connection(database).unsafe(PURGE, [
    seconds,
  ] as never[])) as unknown as { count: number };
  return result.count;
}

export async function minute(database: string): Promise<Date> {
  const rows = (await connection(database).unsafe(
    "select date_trunc('minute', now()) as minute",
  )) as unknown as { minute: Date }[];
  return (rows[0] as { minute: Date }).minute;
}
