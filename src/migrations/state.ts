import { literalQuery } from "../db/compile.ts";
import type { AnyTable } from "../schema/table.ts";
import { isTable, TABLE, tableDefinition } from "../schema/table.ts";
import type { SchemaState, TableDef, ViewDef } from "../schema/types.ts";
import { emptyState } from "../schema/types.ts";
import type { Migration, Operation } from "./operations.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function tableOf(state: SchemaState, name: string): TableDef {
  const table = state.tables[name];
  if (!table) {
    throw new Error(
      `flypath: migration touches "${name}", which no earlier migration creates`,
    );
  }
  return table;
}

export function apply(state: SchemaState, operation: Operation): SchemaState {
  switch (operation.kind) {
    case "createTable":
      state.tables[operation.table.name] = clone(operation.table);
      return state;
    case "dropTable":
      delete state.tables[operation.name];
      return state;
    case "renameTable": {
      const table = tableOf(state, operation.from);
      delete state.tables[operation.from];
      table.name = operation.to;
      state.tables[operation.to] = table;
      return state;
    }
    case "addColumn": {
      const table = tableOf(state, operation.table);
      table.columns[operation.name] = clone(operation.column);
      table.order.push(operation.name);
      return state;
    }
    case "dropColumn": {
      const table = tableOf(state, operation.table);
      delete table.columns[operation.name];
      table.order = table.order.filter((name) => name !== operation.name);
      return state;
    }
    case "renameColumn": {
      const table = tableOf(state, operation.table);
      const column = table.columns[operation.from];
      if (!column) break;
      delete table.columns[operation.from];
      table.columns[operation.to] = column;
      table.order = table.order.map((name) =>
        name === operation.from ? operation.to : name,
      );
      return state;
    }
    case "alterColumn": {
      const table = tableOf(state, operation.table);
      const column = table.columns[operation.name];
      if (!column) break;
      if (operation.change.type !== undefined) {
        column.type = operation.change.type;
      }
      if (operation.change.notNull !== undefined) {
        column.notNull = operation.change.notNull;
      }
      if (operation.change.default !== undefined) {
        if (operation.change.default === null) delete column.default;
        else column.default = clone(operation.change.default);
      }
      return state;
    }
    case "createIndex": {
      const table = tableOf(state, operation.table);
      table.indexes = [
        ...table.indexes.filter((index) => index.name !== operation.index.name),
        clone(operation.index),
      ].sort((left, right) => left.name.localeCompare(right.name));
      return state;
    }
    case "dropIndex": {
      const table = tableOf(state, operation.table);
      table.indexes = table.indexes.filter(
        (index) => index.name !== operation.name,
      );
      return state;
    }
    case "addConstraint": {
      const table = tableOf(state, operation.table);
      table.constraints = [
        ...table.constraints.filter(
          (constraint) => constraint.name !== operation.constraint.name,
        ),
        clone(operation.constraint),
      ].sort((left, right) => left.name.localeCompare(right.name));
      return state;
    }
    case "dropConstraint": {
      const table = tableOf(state, operation.table);
      table.constraints = table.constraints.filter(
        (constraint) => constraint.name !== operation.name,
      );
      return state;
    }
    case "createEnum":
      state.enums[operation.name] = {
        name: operation.name,
        values: [...operation.values],
      };
      return state;
    case "addEnumValue": {
      const enumeration = state.enums[operation.name];
      if (!enumeration) break;
      const values = [...enumeration.values];
      const at = operation.before
        ? values.indexOf(operation.before)
        : operation.after
          ? values.indexOf(operation.after) + 1
          : values.length;
      values.splice(at === -1 ? values.length : at, 0, operation.value);
      enumeration.values = values;
      return state;
    }
    case "renameEnumValue": {
      const enumeration = state.enums[operation.name];
      if (!enumeration) break;
      enumeration.values = enumeration.values.map((value) =>
        value === operation.from ? operation.to : value,
      );
      return state;
    }
    case "dropEnum":
      delete state.enums[operation.name];
      return state;
    case "createExtension":
      state.extensions[operation.name] = { name: operation.name };
      return state;
    case "dropExtension":
      delete state.extensions[operation.name];
      return state;
    case "createSchema":
      state.schemas[operation.name] = { name: operation.name };
      return state;
    case "dropSchema":
      delete state.schemas[operation.name];
      return state;
    case "createSequence":
      state.sequences[operation.sequence.name] = clone(operation.sequence);
      return state;
    case "dropSequence":
      delete state.sequences[operation.name];
      return state;
    case "createView":
      state.views[operation.view.name] = clone(operation.view);
      return state;
    case "dropView":
      delete state.views[operation.name];
      return state;
    case "sql":
    case "run":
      return state;
  }
  return state;
}

export function replay(migrations: readonly Migration[]): SchemaState {
  let state = emptyState();
  for (const file of migrations) {
    for (const operation of file.operations) state = apply(state, operation);
  }
  return state;
}

export class IrreversibleError extends Error {}

export function invert(operation: Operation, before: SchemaState): Operation[] {
  switch (operation.kind) {
    case "createTable":
      return [{ kind: "dropTable", name: operation.table.name }];
    case "dropTable":
      return [
        { kind: "createTable", table: clone(tableOf(before, operation.name)) },
      ];
    case "renameTable":
      return [{ kind: "renameTable", from: operation.to, to: operation.from }];
    case "addColumn":
      return [
        { kind: "dropColumn", table: operation.table, name: operation.name },
      ];
    case "dropColumn": {
      const table = tableOf(before, operation.table);
      const column = table.columns[operation.name];
      if (!column) {
        throw new IrreversibleError(
          `flypath: ${operation.table}.${operation.name} is not in the ` +
            "replayed history, so dropping it cannot be reversed",
        );
      }
      return [
        {
          kind: "addColumn",
          table: operation.table,
          name: operation.name,
          column: clone(column),
        },
      ];
    }
    case "renameColumn":
      return [
        {
          kind: "renameColumn",
          table: operation.table,
          from: operation.to,
          to: operation.from,
        },
      ];
    case "alterColumn": {
      const column = tableOf(before, operation.table).columns[operation.name];
      if (!column) throw new IrreversibleError("flypath: unknown column");
      const change: Operation = {
        kind: "alterColumn",
        table: operation.table,
        name: operation.name,
        change: {
          ...(operation.change.type === undefined ? {} : { type: column.type }),
          ...(operation.change.notNull === undefined
            ? {}
            : { notNull: column.notNull }),
          ...(operation.change.default === undefined
            ? {}
            : { default: column.default ?? null }),
        },
      };
      return [change];
    }
    case "createIndex":
      return [
        {
          kind: "dropIndex",
          table: operation.table,
          name: operation.index.name,
        },
      ];
    case "dropIndex": {
      const index = tableOf(before, operation.table).indexes.find(
        (entry) => entry.name === operation.name,
      );
      if (!index) throw new IrreversibleError("flypath: unknown index");
      return [
        { kind: "createIndex", table: operation.table, index: clone(index) },
      ];
    }
    case "addConstraint":
      return [
        {
          kind: "dropConstraint",
          table: operation.table,
          name: operation.constraint.name,
        },
      ];
    case "dropConstraint": {
      const constraint = tableOf(before, operation.table).constraints.find(
        (entry) => entry.name === operation.name,
      );
      if (!constraint)
        throw new IrreversibleError("flypath: unknown constraint");
      return [
        {
          kind: "addConstraint",
          table: operation.table,
          constraint: clone(constraint),
        },
      ];
    }
    case "createEnum":
      return [{ kind: "dropEnum", name: operation.name }];
    case "dropEnum": {
      const enumeration = before.enums[operation.name];
      if (!enumeration) throw new IrreversibleError("flypath: unknown enum");
      return [
        {
          kind: "createEnum",
          name: enumeration.name,
          values: [...enumeration.values],
        },
      ];
    }
    case "addEnumValue":
      throw new IrreversibleError(
        `flypath: Postgres cannot remove the enum value "${operation.value}", ` +
          `so adding it to "${operation.name}" is irreversible`,
      );
    case "renameEnumValue":
      return [
        {
          kind: "renameEnumValue",
          name: operation.name,
          from: operation.to,
          to: operation.from,
        },
      ];
    case "createExtension":
      return [{ kind: "dropExtension", name: operation.name }];
    case "dropExtension":
      return [{ kind: "createExtension", name: operation.name }];
    case "createSchema":
      return [{ kind: "dropSchema", name: operation.name }];
    case "dropSchema":
      return [{ kind: "createSchema", name: operation.name }];
    case "createSequence":
      return [{ kind: "dropSequence", name: operation.sequence.name }];
    case "dropSequence": {
      const sequence = before.sequences[operation.name];
      if (!sequence) throw new IrreversibleError("flypath: unknown sequence");
      return [{ kind: "createSequence", sequence: clone(sequence) }];
    }
    case "createView":
      return [
        {
          kind: "dropView",
          name: operation.view.name,
          materialized: operation.view.materialized,
        },
      ];
    case "dropView": {
      const definition = before.views[operation.name];
      if (!definition) throw new IrreversibleError("flypath: unknown view");
      return [{ kind: "createView", view: clone(definition) }];
    }
    case "sql":
      if (operation.down === undefined) {
        throw new IrreversibleError(
          "flypath: this sql() operation has no down, so it cannot be reversed",
        );
      }
      return [{ kind: "sql", up: operation.down }];
    case "run":
      if (operation.down === undefined) {
        throw new IrreversibleError(
          "flypath: this run() operation has no down, so it cannot be reversed",
        );
      }
      return [{ kind: "run", up: operation.down }];
  }
}

export function schemaState(module: Record<string, unknown>): SchemaState {
  const state = emptyState();

  for (const value of Object.values(module)) {
    if (isTable(value)) {
      const definition = tableDefinition((value as AnyTable)[TABLE]);
      state.tables[definition.name] = definition;
      continue;
    }
    if (typeof value === "function" && "enumDef" in value) {
      const definition = (
        value as { enumDef: { name: string; values: string[] } }
      ).enumDef;
      state.enums[definition.name] = {
        name: definition.name,
        values: [...definition.values],
      };
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const marker = (value as { flypath?: string }).flypath;
    if (marker === "extension") {
      const { name } = value as { name: string };
      state.extensions[name] = { name };
    } else if (marker === "schema") {
      const { name } = value as { name: string };
      state.schemas[name] = { name };
    } else if (marker === "sequence") {
      const sequence = value as {
        name: string;
        type?: string;
        start?: number;
        increment?: number;
      };
      state.sequences[sequence.name] = {
        name: sequence.name,
        ...(sequence.type === undefined ? {} : { type: sequence.type }),
        ...(sequence.start === undefined ? {} : { start: sequence.start }),
        ...(sequence.increment === undefined
          ? {}
          : { increment: sequence.increment }),
      };
    } else if (marker === "view") {
      const source = value as {
        name: string;
        materialized: boolean;
        ir: Parameters<typeof literalQuery>[0];
      };
      const definition: ViewDef = {
        name: source.name,
        materialized: source.materialized,
        query: literalQuery(source.ir),
        columns: [],
      };
      state.views[source.name] = definition;
    }
  }

  return state;
}
