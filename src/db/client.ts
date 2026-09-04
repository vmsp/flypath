import postgres from "postgres";

import { connectionUrl, databaseOptions } from "./config.ts";
import type { Compiled } from "./ir.ts";
import { currentConnection } from "./transaction.ts";

export type Connection = postgres.Sql<Record<string, never>>;

export type TransactionConnection = postgres.TransactionSql<
  Record<string, never>
>;

const KEY = "__flypathPools";

type Holder = { [KEY]?: Map<string, Connection> };

const holder = globalThis as unknown as Holder;

const pools: Map<string, Connection> = (holder[KEY] ??= new Map<
  string,
  Connection
>());

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const MIN_SAFE = -MAX_SAFE;

function parseBigint(value: string): number {
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE || parsed < MIN_SAFE) {
    throw new Error(
      `flypath: ${value} does not fit in a JavaScript number; declare the ` +
        'column as bigint({ mode: "bigint" })',
    );
  }
  return Number(parsed);
}

function utcDate(value: string): Date {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(`${normalized}Z`);
}

const types = {
  bigint: {
    to: 20,
    from: [20],
    serialize: (value: number | bigint): string => value.toString(),
    parse: parseBigint,
  },
  numeric: {
    to: 1700,
    from: [1700],
    serialize: (value: string | number): string => String(value),
    parse: (value: string): string => value,
  },
  date: {
    to: 1082,
    from: [1082],
    serialize: (value: string): string => value,
    parse: (value: string): string => value,
  },
  timestamp: {
    to: 1114,
    from: [1114],
    serialize: (value: Date | string): string =>
      value instanceof Date ? value.toISOString().replace("Z", "") : value,
    parse: utcDate,
  },
};

export function pool(name = "default"): Connection {
  const existing = pools.get(name);
  if (existing) return existing;

  const options = databaseOptions(name);
  const created = postgres(connectionUrl(name), {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 0,
    connect_timeout: options.connectTimeout ?? 30,
    ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
    ...(options.searchPath === undefined
      ? {}
      : { connection: { search_path: options.searchPath } }),
    types,
    prepare: true,
    onnotice: () => undefined,
  }) as unknown as Connection;

  pools.set(name, created);
  return created;
}

export function connection(name: string): Connection {
  return currentConnection(name) ?? pool(name);
}

export async function execute(
  name: string,
  compiled: Compiled,
): Promise<Record<string, unknown>[]> {
  const target = connection(name);
  const result = await target.unsafe(compiled.text, compiled.params as never[]);
  return result as unknown as Record<string, unknown>[];
}

export async function executeCount(
  name: string,
  compiled: Compiled,
): Promise<number> {
  const target = connection(name);
  const result = await target.unsafe(compiled.text, compiled.params as never[]);
  return (result as unknown as { count: number }).count;
}

export async function* stream(
  name: string,
  compiled: Compiled,
  size: number,
): AsyncGenerator<Record<string, unknown>, void, undefined> {
  const target = connection(name);
  const cursor = target
    .unsafe(compiled.text, compiled.params as never[])
    .cursor(size);
  for await (const rows of cursor) {
    for (const row of rows) yield row as unknown as Record<string, unknown>;
  }
}

export async function closePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((client) => client.end({ timeout: 5 })));
}
