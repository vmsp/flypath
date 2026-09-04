import { literalText, quote } from "../db/compile.ts";
import type {
  ColumnDef,
  ConstraintDef,
  DefaultValue,
  IndexDef,
  TableDef,
} from "../schema/types.ts";
import type { Operation } from "./operations.ts";
import { compactOrder } from "./order.ts";

function columnType(column: ColumnDef): string {
  return column.type + "[]".repeat(column.array);
}

function defaultText(value: DefaultValue): string {
  return value.kind === "expression" ? value.text : literalText(value.value);
}

function columnClause(name: string, column: ColumnDef): string {
  const parts = [quote(name), columnType(column)];
  if (column.collate) parts.push(`collate ${quote(column.collate)}`);
  if (column.generated) {
    parts.push(`generated always as (${column.generated}) stored`);
  }
  if (column.identity) {
    const options: string[] = [];
    if (column.identity.start !== undefined) {
      options.push(`start with ${String(column.identity.start)}`);
    }
    if (column.identity.increment !== undefined) {
      options.push(`increment by ${String(column.identity.increment)}`);
    }
    parts.push(
      `generated ${column.identity.always ? "always" : "by default"} as identity` +
        (options.length > 0 ? ` (${options.join(" ")})` : ""),
    );
  }
  if (column.default !== undefined) {
    parts.push(`default ${defaultText(column.default)}`);
  }
  if (column.notNull) parts.push("not null");
  return parts.join(" ");
}

function constraintClause(constraint: ConstraintDef): string {
  const columns = (list: readonly string[]): string =>
    list.map((name) => quote(name)).join(", ");

  switch (constraint.kind) {
    case "primaryKey":
      return `constraint ${quote(constraint.name)} primary key (${columns(
        constraint.columns,
      )})`;
    case "unique":
      return (
        `constraint ${quote(constraint.name)} unique` +
        (constraint.nullsNotDistinct ? " nulls not distinct" : "") +
        ` (${columns(constraint.columns)})`
      );
    case "check":
      return `constraint ${quote(constraint.name)} check (${constraint.expression})`;
    case "foreignKey": {
      const parts = [
        `constraint ${quote(constraint.name)} foreign key (${columns(
          constraint.columns,
        )})`,
        `references ${quote(constraint.table)} (${columns(constraint.references)})`,
      ];
      if (constraint.onDelete) parts.push(`on delete ${constraint.onDelete}`);
      if (constraint.onUpdate) parts.push(`on update ${constraint.onUpdate}`);
      if (constraint.deferrable) parts.push("deferrable initially deferred");
      return parts.join(" ");
    }
  }
}

function indexStatement(table: string, index: IndexDef): string {
  const members = index.members
    .map((member) => {
      const direction = member.direction ? ` ${member.direction}` : "";
      const nulls = member.nulls ? ` nulls ${member.nulls}` : "";
      return `${member.expression}${direction}${nulls}`;
    })
    .join(", ");

  const parts = [
    "create",
    index.unique ? "unique" : "",
    "index",
    index.concurrently ? "concurrently" : "",
    quote(index.name),
    `on ${quote(table)}`,
    index.using ? `using ${index.using}` : "",
    `(${members})`,
    index.include && index.include.length > 0
      ? `include (${index.include.map((name) => quote(name)).join(", ")})`
      : "",
    index.nullsNotDistinct ? "nulls not distinct" : "",
    index.where ? `where ${index.where}` : "",
  ];
  return parts.filter((part) => part !== "").join(" ");
}

function createTableStatements(table: TableDef): string[] {
  const order = compactOrder(table);
  const lines = [
    ...order.map((name) =>
      columnClause(name, table.columns[name] as ColumnDef),
    ),
    ...table.constraints.map((constraint) => constraintClause(constraint)),
  ];
  const qualified = table.schema
    ? `${quote(table.schema)}.${quote(table.name)}`
    : quote(table.name);
  const statements = [
    `create table ${qualified} (\n  ${lines.join(",\n  ")}\n)`,
  ];
  for (const index of table.indexes) {
    statements.push(indexStatement(table.name, index));
  }
  if (table.comment !== undefined) {
    statements.push(
      `comment on table ${qualified} is ${literalText(table.comment)}`,
    );
  }
  for (const name of order) {
    const column = table.columns[name] as ColumnDef;
    if (column.comment !== undefined) {
      statements.push(
        `comment on column ${qualified}.${quote(name)} is ${literalText(
          column.comment,
        )}`,
      );
    }
  }
  return statements;
}

export function statements(operation: Operation): string[] {
  switch (operation.kind) {
    case "createTable":
      return createTableStatements(operation.table);
    case "dropTable":
      return [`drop table ${quote(operation.name)}`];
    case "renameTable":
      return [
        `alter table ${quote(operation.from)} rename to ${quote(operation.to)}`,
      ];
    case "addColumn":
      return [
        `alter table ${quote(operation.table)} add column ${columnClause(
          operation.name,
          operation.column,
        )}`,
      ];
    case "dropColumn":
      return [
        `alter table ${quote(operation.table)} drop column ${quote(
          operation.name,
        )}`,
      ];
    case "renameColumn":
      return [
        `alter table ${quote(operation.table)} rename column ${quote(
          operation.from,
        )} to ${quote(operation.to)}`,
      ];
    case "alterColumn": {
      const column = quote(operation.name);
      const prefix = `alter table ${quote(operation.table)} alter column ${column}`;
      const out: string[] = [];
      if (operation.change.type !== undefined) {
        out.push(
          `${prefix} type ${operation.change.type}` +
            (operation.change.using ? ` using ${operation.change.using}` : ""),
        );
      }
      if (operation.change.notNull !== undefined) {
        out.push(
          `${prefix} ${operation.change.notNull ? "set" : "drop"} not null`,
        );
      }
      if (operation.change.default !== undefined) {
        out.push(
          operation.change.default === null
            ? `${prefix} drop default`
            : `${prefix} set default ${defaultText(operation.change.default)}`,
        );
      }
      return out;
    }
    case "createIndex":
      return [indexStatement(operation.table, operation.index)];
    case "dropIndex":
      return [`drop index ${quote(operation.name)}`];
    case "addConstraint":
      return [
        `alter table ${quote(operation.table)} add ${constraintClause(
          operation.constraint,
        )}`,
      ];
    case "dropConstraint":
      return [
        `alter table ${quote(operation.table)} drop constraint ${quote(
          operation.name,
        )}`,
      ];
    case "createEnum":
      return [
        `create type ${quote(operation.name)} as enum (${operation.values
          .map((value) => literalText(value))
          .join(", ")})`,
      ];
    case "addEnumValue":
      return [
        `alter type ${quote(operation.name)} add value ${literalText(
          operation.value,
        )}` +
          (operation.before
            ? ` before ${literalText(operation.before)}`
            : operation.after
              ? ` after ${literalText(operation.after)}`
              : ""),
      ];
    case "renameEnumValue":
      return [
        `alter type ${quote(operation.name)} rename value ${literalText(
          operation.from,
        )} to ${literalText(operation.to)}`,
      ];
    case "dropEnum":
      return [`drop type ${quote(operation.name)}`];
    case "createExtension":
      return [`create extension if not exists ${quote(operation.name)}`];
    case "dropExtension":
      return [`drop extension ${quote(operation.name)}`];
    case "createSchema":
      return [`create schema ${quote(operation.name)}`];
    case "dropSchema":
      return [`drop schema ${quote(operation.name)}`];
    case "createSequence": {
      const parts = [`create sequence ${quote(operation.sequence.name)}`];
      if (operation.sequence.type) parts.push(`as ${operation.sequence.type}`);
      if (operation.sequence.increment !== undefined) {
        parts.push(`increment by ${String(operation.sequence.increment)}`);
      }
      if (operation.sequence.start !== undefined) {
        parts.push(`start with ${String(operation.sequence.start)}`);
      }
      return [parts.join(" ")];
    }
    case "dropSequence":
      return [`drop sequence ${quote(operation.name)}`];
    case "createView":
      return [
        `create ${operation.view.materialized ? "materialized " : ""}view ${quote(
          operation.view.name,
        )} as ${operation.view.query}`,
      ];
    case "dropView":
      return [
        `drop ${operation.materialized ? "materialized " : ""}view ${quote(
          operation.name,
        )}`,
      ];
    case "sql":
      return [operation.up];
    case "run":
      return [];
  }
}
