import type {
  ColumnDef,
  ConstraintDef,
  IndexDef,
  SchemaState,
  TableDef,
} from "../schema/types.ts";
import type { ColumnChange, Operation } from "./operations.ts";

export type Prompt = {
  confirm: (question: string) => Promise<boolean>;
  value: (question: string) => Promise<string | undefined>;
};

export const conservative: Prompt = {
  confirm: async () => false,
  value: async () => undefined,
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shape(column: ColumnDef): string {
  return JSON.stringify({
    type: column.type,
    array: column.array,
    notNull: column.notNull,
  });
}

function tableShape(table: TableDef): string {
  return JSON.stringify(
    [...table.order]
      .sort()
      .map((name) => `${name}:${shape(table.columns[name] as ColumnDef)}`),
  );
}

function dependencyOrder(tables: readonly TableDef[]): TableDef[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const seen = new Set<string>();
  const out: TableDef[] = [];

  const visit = (table: TableDef, stack: Set<string>): void => {
    if (seen.has(table.name) || stack.has(table.name)) return;
    stack.add(table.name);
    for (const constraint of table.constraints) {
      if (constraint.kind !== "foreignKey") continue;
      const target = byName.get(constraint.table);
      if (target && target !== table) visit(target, stack);
    }
    stack.delete(table.name);
    if (seen.has(table.name)) return;
    seen.add(table.name);
    out.push(table);
  };

  for (const table of tables) visit(table, new Set());
  return out;
}

function columnChange(
  before: ColumnDef,
  after: ColumnDef,
): ColumnChange | undefined {
  const change: ColumnChange = {};
  if (before.type !== after.type || before.array !== after.array) {
    change.type = after.type + "[]".repeat(after.array);
  }
  if (before.notNull !== after.notNull) change.notNull = after.notNull;
  if (!same(before.default, after.default)) {
    change.default = after.default ?? null;
  }
  return Object.keys(change).length === 0 ? undefined : change;
}

export async function diff(
  from: SchemaState,
  to: SchemaState,
  prompt: Prompt = conservative,
): Promise<Operation[]> {
  const creates: Operation[] = [];
  const alters: Operation[] = [];
  const drops: Operation[] = [];

  for (const name of Object.keys(to.extensions)) {
    if (!from.extensions[name]) creates.push({ kind: "createExtension", name });
  }
  for (const name of Object.keys(from.extensions)) {
    if (!to.extensions[name]) drops.push({ kind: "dropExtension", name });
  }

  for (const name of Object.keys(to.schemas)) {
    if (!from.schemas[name]) creates.push({ kind: "createSchema", name });
  }
  for (const name of Object.keys(from.schemas)) {
    if (!to.schemas[name]) drops.push({ kind: "dropSchema", name });
  }

  for (const [name, target] of Object.entries(to.enums)) {
    const current = from.enums[name];
    if (!current) {
      creates.push({ kind: "createEnum", name, values: [...target.values] });
      continue;
    }
    const added = target.values.filter(
      (value) => !current.values.includes(value),
    );
    const removed = current.values.filter(
      (value) => !target.values.includes(value),
    );
    if (removed.length > 0) {
      creates.push({
        kind: "sql",
        up:
          `-- Postgres cannot drop enum values; rebuild "${name}" by hand:\n` +
          `-- create type "${name}_new" as enum (…); ` +
          `alter table … alter column … type "${name}_new" using …::text::"${name}_new"; ` +
          `drop type "${name}"; alter type "${name}_new" rename to "${name}";`,
      });
    }
    for (const [at, value] of added.entries()) {
      const previous = target.values[target.values.indexOf(value) - 1];
      creates.push({
        kind: "addEnumValue",
        name,
        value,
        ...(previous === undefined || at > 0 ? {} : { after: previous }),
      });
    }
  }
  for (const name of Object.keys(from.enums)) {
    if (!to.enums[name]) drops.push({ kind: "dropEnum", name });
  }

  for (const [name, target] of Object.entries(to.sequences)) {
    if (!from.sequences[name]) {
      creates.push({ kind: "createSequence", sequence: target });
    }
  }
  for (const name of Object.keys(from.sequences)) {
    if (!to.sequences[name]) drops.push({ kind: "dropSequence", name });
  }

  const addedTables = Object.keys(to.tables).filter(
    (name) => !from.tables[name],
  );
  const droppedTables = Object.keys(from.tables).filter(
    (name) => !to.tables[name],
  );
  const renamedTables = new Map<string, string>();

  for (const dropped of [...droppedTables]) {
    const before = from.tables[dropped] as TableDef;
    for (const added of addedTables) {
      const after = to.tables[added] as TableDef;
      if (tableShape(before) !== tableShape(after)) continue;
      const yes = await prompt.confirm(
        `Did you rename the table "${dropped}" to "${added}"?`,
      );
      if (!yes) continue;
      renamedTables.set(dropped, added);
      addedTables.splice(addedTables.indexOf(added), 1);
      droppedTables.splice(droppedTables.indexOf(dropped), 1);
      break;
    }
  }

  for (const [before, after] of renamedTables) {
    creates.push({ kind: "renameTable", from: before, to: after });
  }

  const created = dependencyOrder(
    addedTables.map((name) => to.tables[name] as TableDef),
  );
  for (const table of created) {
    creates.push({ kind: "createTable", table });
  }

  for (const name of droppedTables) {
    drops.push({ kind: "dropTable", name });
  }

  for (const [name, after] of Object.entries(to.tables)) {
    const previousName =
      [...renamedTables.entries()].find(([, value]) => value === name)?.[0] ??
      name;
    const before = from.tables[previousName];
    if (!before) continue;

    const addedColumns = after.order.filter(
      (column) => !before.columns[column],
    );
    const droppedColumns = before.order.filter(
      (column) => !after.columns[column],
    );

    for (const dropped of [...droppedColumns]) {
      const previous = before.columns[dropped] as ColumnDef;
      for (const added of addedColumns) {
        const next = after.columns[added] as ColumnDef;
        if (previous.type !== next.type || previous.array !== next.array) {
          continue;
        }
        const yes = await prompt.confirm(
          `Did you rename "${name}"."${dropped}" to "${added}"?`,
        );
        if (!yes) continue;
        alters.push({
          kind: "renameColumn",
          table: name,
          from: dropped,
          to: added,
        });
        addedColumns.splice(addedColumns.indexOf(added), 1);
        droppedColumns.splice(droppedColumns.indexOf(dropped), 1);
        break;
      }
    }

    for (const column of addedColumns) {
      const definition = after.columns[column] as ColumnDef;
      if (
        definition.notNull &&
        definition.default === undefined &&
        !definition.identity &&
        !definition.generated
      ) {
        const supplied = await prompt.value(
          `"${name}"."${column}" is not null with no default. Enter a ` +
            "one-time SQL default for existing rows, or leave empty to abort:",
        );
        if (supplied === undefined || supplied.trim() === "") {
          throw new Error(
            `flypath: "${name}"."${column}" is not null and has no default, ` +
              "so existing rows have nothing to hold; give it .default(…) or " +
              "run makemigration interactively",
          );
        }
        alters.push({
          kind: "addColumn",
          table: name,
          name: column,
          column: {
            ...definition,
            default: { kind: "expression", text: supplied },
          },
        });
        alters.push({
          kind: "alterColumn",
          table: name,
          name: column,
          change: { default: null },
        });
        continue;
      }
      alters.push({
        kind: "addColumn",
        table: name,
        name: column,
        column: definition,
      });
    }

    for (const column of droppedColumns) {
      drops.push({ kind: "dropColumn", table: name, name: column });
    }

    for (const column of after.order) {
      const previous = before.columns[column];
      const next = after.columns[column];
      if (!previous || !next) continue;
      const change = columnChange(previous, next);
      if (change) {
        alters.push({ kind: "alterColumn", table: name, name: column, change });
      }
    }

    diffNamed(
      before.constraints,
      after.constraints,
      (constraint: ConstraintDef) =>
        alters.push({ kind: "addConstraint", table: name, constraint }),
      (constraintName) =>
        drops.push({
          kind: "dropConstraint",
          table: name,
          name: constraintName,
        }),
    );

    diffNamed(
      before.indexes,
      after.indexes,
      (index: IndexDef) =>
        alters.push({ kind: "createIndex", table: name, index }),
      (indexName) =>
        drops.push({ kind: "dropIndex", table: name, name: indexName }),
    );
  }

  for (const [name, target] of Object.entries(to.views)) {
    const current = from.views[name];
    if (!current) {
      creates.push({ kind: "createView", view: target });
    } else if (current.query !== target.query) {
      alters.push({
        kind: "dropView",
        name,
        materialized: current.materialized,
      });
      alters.push({ kind: "createView", view: target });
    }
  }
  for (const [name, current] of Object.entries(from.views)) {
    if (!to.views[name]) {
      drops.push({
        kind: "dropView",
        name,
        materialized: current.materialized,
      });
    }
  }

  return [...creates, ...alters, ...drops.reverse()];
}

function diffNamed<T extends { name: string }>(
  before: readonly T[],
  after: readonly T[],
  add: (value: T) => void,
  remove: (name: string) => void,
): void {
  const previous = new Map(before.map((entry) => [entry.name, entry]));
  const next = new Map(after.map((entry) => [entry.name, entry]));

  for (const [name, entry] of next) {
    const current = previous.get(name);
    if (!current) {
      add(entry);
    } else if (!same(current, entry)) {
      remove(name);
      add(entry);
    }
  }
  for (const name of previous.keys()) {
    if (!next.has(name)) remove(name);
  }
}
