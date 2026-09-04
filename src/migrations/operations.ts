import type { AnyColumn } from "../schema/column.ts";
import type { Columns, Extra } from "../schema/table.ts";
import { defineTable } from "../schema/table.ts";
import type {
  ColumnDef,
  ConstraintDef,
  DefaultValue,
  IndexDef,
  SequenceDef,
  TableDef,
  ViewDef,
} from "../schema/types.ts";

export type ColumnChange = {
  type?: string;
  using?: string;
  notNull?: boolean;
  default?: DefaultValue | null;
};

export type Operation =
  | { kind: "createTable"; table: TableDef }
  | { kind: "dropTable"; name: string }
  | { kind: "renameTable"; from: string; to: string }
  | { kind: "addColumn"; table: string; name: string; column: ColumnDef }
  | { kind: "dropColumn"; table: string; name: string }
  | { kind: "renameColumn"; table: string; from: string; to: string }
  | { kind: "alterColumn"; table: string; name: string; change: ColumnChange }
  | { kind: "createIndex"; table: string; index: IndexDef }
  | { kind: "dropIndex"; table: string; name: string }
  | { kind: "addConstraint"; table: string; constraint: ConstraintDef }
  | { kind: "dropConstraint"; table: string; name: string }
  | { kind: "createEnum"; name: string; values: string[] }
  | {
      kind: "addEnumValue";
      name: string;
      value: string;
      before?: string;
      after?: string;
    }
  | { kind: "renameEnumValue"; name: string; from: string; to: string }
  | { kind: "dropEnum"; name: string }
  | { kind: "createExtension"; name: string }
  | { kind: "dropExtension"; name: string }
  | { kind: "createSchema"; name: string }
  | { kind: "dropSchema"; name: string }
  | { kind: "createSequence"; sequence: SequenceDef }
  | { kind: "dropSequence"; name: string }
  | { kind: "createView"; view: ViewDef }
  | { kind: "dropView"; name: string; materialized: boolean }
  | { kind: "sql"; up: string; down?: string }
  | { kind: "run"; up: () => Promise<void>; down?: () => Promise<void> };

export type Migration = {
  operations: readonly Operation[];
  transaction: boolean;
};

export function migration(
  operations: readonly Operation[],
  options: { transaction?: boolean } = {},
): Migration {
  return { operations, transaction: options.transaction ?? true };
}

export function createTable<Cols extends Columns>(
  name: string,
  columns: Cols,
  extras?: (t: Cols) => readonly Extra[],
): Operation {
  return { kind: "createTable", table: defineTable(name, columns, extras) };
}

export function dropTable(name: string): Operation {
  return { kind: "dropTable", name };
}

export function renameTable(from: string, to: string): Operation {
  return { kind: "renameTable", from, to };
}

export function addColumn(
  table: string,
  name: string,
  column: AnyColumn,
): Operation {
  column.table = table;
  column.name = name;
  column.resolve();
  return { kind: "addColumn", table, name, column: column.def };
}

export function dropColumn(table: string, name: string): Operation {
  return { kind: "dropColumn", table, name };
}

export function renameColumn(
  table: string,
  from: string,
  to: string,
): Operation {
  return { kind: "renameColumn", table, from, to };
}

export function alterColumn(
  table: string,
  name: string,
  change: ColumnChange,
): Operation {
  return { kind: "alterColumn", table, name, change };
}

export function createIndex(table: string, index: IndexDef): Operation {
  return { kind: "createIndex", table, index };
}

export function dropIndex(table: string, name: string): Operation {
  return { kind: "dropIndex", table, name };
}

export function addConstraint(
  table: string,
  constraint: ConstraintDef,
): Operation {
  return { kind: "addConstraint", table, constraint };
}

export function dropConstraint(table: string, name: string): Operation {
  return { kind: "dropConstraint", table, name };
}

export function createEnum(name: string, values: string[]): Operation {
  return { kind: "createEnum", name, values };
}

export function addEnumValue(
  name: string,
  value: string,
  position: { before?: string; after?: string } = {},
): Operation {
  return { kind: "addEnumValue", name, value, ...position };
}

export function renameEnumValue(
  name: string,
  from: string,
  to: string,
): Operation {
  return { kind: "renameEnumValue", name, from, to };
}

export function dropEnum(name: string): Operation {
  return { kind: "dropEnum", name };
}

export function createExtension(name: string): Operation {
  return { kind: "createExtension", name };
}

export function dropExtension(name: string): Operation {
  return { kind: "dropExtension", name };
}

export function createSchema(name: string): Operation {
  return { kind: "createSchema", name };
}

export function dropSchema(name: string): Operation {
  return { kind: "dropSchema", name };
}

export function createSequence(sequence: SequenceDef): Operation {
  return { kind: "createSequence", sequence };
}

export function dropSequence(name: string): Operation {
  return { kind: "dropSequence", name };
}

export function createView(view: ViewDef): Operation {
  return { kind: "createView", view };
}

export function dropView(name: string): Operation {
  return { kind: "dropView", name, materialized: false };
}

export function createMaterializedView(view: ViewDef): Operation {
  return { kind: "createView", view: { ...view, materialized: true } };
}

export function dropMaterializedView(name: string): Operation {
  return { kind: "dropView", name, materialized: true };
}

export function sql(options: { up: string; down?: string }): Operation {
  return { kind: "sql", ...options };
}

export function run(options: {
  up: () => Promise<void>;
  down?: () => Promise<void>;
}): Operation {
  return { kind: "run", ...options };
}
