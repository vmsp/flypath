import type { ColumnDef, TableDef } from "../schema/types.ts";

type Tier = { align: number; size: number };

const FIXED: Record<string, Tier> = {
  interval: { align: 8, size: 16 },
  point: { align: 8, size: 16 },
  timetz: { align: 8, size: 12 },
  bigint: { align: 8, size: 8 },
  int8: { align: 8, size: 8 },
  "double precision": { align: 8, size: 8 },
  float8: { align: 8, size: 8 },
  timestamp: { align: 8, size: 8 },
  timestamptz: { align: 8, size: 8 },
  "timestamp with time zone": { align: 8, size: 8 },
  "timestamp without time zone": { align: 8, size: 8 },
  time: { align: 8, size: 8 },
  money: { align: 8, size: 8 },
  macaddr: { align: 4, size: 6 },
  integer: { align: 4, size: 4 },
  int: { align: 4, size: 4 },
  int4: { align: 4, size: 4 },
  real: { align: 4, size: 4 },
  float4: { align: 4, size: 4 },
  date: { align: 4, size: 4 },
  smallint: { align: 2, size: 2 },
  int2: { align: 2, size: 2 },
  boolean: { align: 1, size: 1 },
  bool: { align: 1, size: 1 },
  uuid: { align: 1, size: 16 },
};

const ENUM: Tier = { align: 4, size: 4 };

function base(type: string): string {
  const at = type.indexOf("(");
  return (at === -1 ? type : type.slice(0, at)).trim().toLowerCase();
}

function tierOf(column: ColumnDef): Tier | null {
  if (column.array > 0) return null;
  if (column.enum) return ENUM;
  return FIXED[base(column.type)] ?? null;
}

export function compactOrder(table: TableDef): string[] {
  const fixed: { name: string; tier: Tier; at: number }[] = [];
  const variable: string[] = [];

  for (const [at, name] of table.order.entries()) {
    const column = table.columns[name];
    if (!column) continue;
    const tier = tierOf(column);
    if (tier) fixed.push({ name, tier, at });
    else variable.push(name);
  }

  fixed.sort((left, right) => {
    if (left.tier.align !== right.tier.align) {
      return right.tier.align - left.tier.align;
    }
    if (left.tier.size !== right.tier.size) {
      return right.tier.size - left.tier.size;
    }
    return left.at - right.at;
  });

  return [...fixed.map((entry) => entry.name), ...variable];
}
