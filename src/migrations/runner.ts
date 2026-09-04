import { connection, pool } from "../db/client.ts";
import { transaction } from "../db/transaction.ts";
import type { SchemaState } from "../schema/types.ts";
import { emptyState } from "../schema/types.ts";
import { statements } from "./ddl.ts";
import type { MigrationFile } from "./files.ts";
import { discover, loadAll } from "./files.ts";
import type { Migration, Operation } from "./operations.ts";
import { apply, invert } from "./state.ts";

const LOCK_KEY = 8_263_744_912_015n;

const TABLE = "flypath_migrations";

type Loaded = { file: MigrationFile; migration: Migration };

export type Status = {
  applied: { name: string; at: Date }[];
  pending: Loaded[];
  missing: string[];
};

async function ensureTable(database: string): Promise<void> {
  await pool(database).unsafe(
    `create table if not exists ${TABLE} (` +
      "name text primary key, applied_at timestamptz not null default now())",
  );
}

async function appliedNames(
  database: string,
): Promise<{ name: string; at: Date }[]> {
  const rows = (await pool(database).unsafe(
    `select name, applied_at from ${TABLE} order by name`,
  )) as unknown as { name: string; applied_at: Date }[];
  return rows.map((row) => ({ name: row.name, at: row.applied_at }));
}

export async function status(
  root: string,
  database = "default",
): Promise<Status> {
  await ensureTable(database);
  const files = discover(root);
  const applied = await appliedNames(database);
  const names = new Set(applied.map((row) => row.name));
  const loaded = await loadAll(files.filter((file) => !names.has(file.id)));
  return {
    applied,
    pending: loaded,
    missing: [...names].filter(
      (name) => !files.some((file) => file.id === name),
    ),
  };
}

async function runOperations(
  database: string,
  operations: readonly Operation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === "run") {
      await operation.up();
      continue;
    }
    for (const text of statements(operation)) {
      await connection(database).unsafe(text);
    }
  }
}

export type Plan = { file: MigrationFile; operations: readonly Operation[] };

export async function migratePlan(
  root: string,
  database = "default",
  to?: string,
): Promise<Plan[]> {
  const current = await status(root, database);
  if (current.missing.length > 0) {
    throw new Error(
      `flypath: ${current.missing.join(", ")} is recorded as applied but has ` +
        "no file in db/migrations",
    );
  }
  const pending =
    to === undefined
      ? current.pending
      : current.pending.filter((entry) => entry.file.timestamp <= to);
  return pending.map((entry) => ({
    file: entry.file,
    operations: entry.migration.operations,
  }));
}

export async function migrate(
  root: string,
  options: { database?: string; to?: string } = {},
): Promise<MigrationFile[]> {
  const database = options.database ?? "default";
  const files = discover(root);
  const done: MigrationFile[] = [];

  const client = pool(database);
  await client.unsafe(`select pg_advisory_lock(${LOCK_KEY.toString()})`);
  try {
    await ensureTable(database);
    const applied = new Set(
      (await appliedNames(database)).map((row) => row.name),
    );
    const pending = files.filter((file) => !applied.has(file.id));
    const upTo = options.to;
    const selected =
      upTo === undefined
        ? pending
        : pending.filter((file) => file.timestamp <= upTo);

    for (const file of selected) {
      const loaded = await loadAll([file]);
      const entry = loaded[0];
      if (!entry) continue;
      const record = async (): Promise<void> => {
        await runOperations(database, entry.migration.operations);
        await connection(database).unsafe(
          `insert into ${TABLE} (name) values ($1)`,
          [file.id],
        );
      };
      if (entry.migration.transaction) {
        await transaction(record, { name: database });
      } else {
        await record();
      }
      done.push(file);
    }
  } finally {
    await client.unsafe(`select pg_advisory_unlock(${LOCK_KEY.toString()})`);
  }

  return done;
}

async function stateBefore(
  root: string,
  target: string,
): Promise<{ state: SchemaState; migration: Migration }> {
  const files = discover(root);
  let state = emptyState();
  let migration: Migration | undefined;
  for (const entry of await loadAll(files)) {
    if (entry.file.id === target) {
      migration = entry.migration;
      break;
    }
    for (const operation of entry.migration.operations) {
      state = apply(state, operation);
    }
  }
  if (!migration) {
    throw new Error(`flypath: ${target} has no file in db/migrations`);
  }
  return { state, migration };
}

function inverse(migration: Migration, before: SchemaState): Operation[] {
  const states: SchemaState[] = [structuredClone(before)];
  let state = structuredClone(before);
  for (const operation of migration.operations) {
    state = apply(state, operation);
    states.push(structuredClone(state));
  }

  const reversed: Operation[] = [];
  for (let at = migration.operations.length - 1; at >= 0; at -= 1) {
    const operation = migration.operations[at] as Operation;
    reversed.push(...invert(operation, states[at] as SchemaState));
  }
  return reversed;
}

export async function rollback(
  root: string,
  options: { database?: string; step?: number; to?: string } = {},
): Promise<MigrationFile[]> {
  const database = options.database ?? "default";
  const files = discover(root);
  const client = pool(database);

  await client.unsafe(`select pg_advisory_lock(${LOCK_KEY.toString()})`);
  try {
    await ensureTable(database);
    const applied = (await appliedNames(database)).map((row) => row.name);
    const appliedFiles = files
      .filter((file) => applied.includes(file.id))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    const downTo = options.to;
    const selected =
      downTo === undefined
        ? appliedFiles.slice(0, options.step ?? 1)
        : appliedFiles.filter((file) => file.timestamp > downTo);

    const plans: { file: MigrationFile; operations: Operation[] }[] = [];
    for (const file of selected) {
      const { state, migration } = await stateBefore(root, file.id);
      plans.push({ file, operations: inverse(migration, state) });
    }

    const done: MigrationFile[] = [];
    for (const plan of plans) {
      await transaction(
        async () => {
          await runOperations(database, plan.operations);
          await connection(database).unsafe(
            `delete from ${TABLE} where name = $1`,
            [plan.file.id],
          );
        },
        { name: database },
      );
      done.push(plan.file);
    }
    return done;
  } finally {
    await client.unsafe(`select pg_advisory_unlock(${LOCK_KEY.toString()})`);
  }
}
