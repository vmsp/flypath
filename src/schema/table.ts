import { literal, queryColumns } from "../db/compile.ts";
import type { Expr } from "../db/expression.ts";
import type { QueryIR } from "../db/ir.ts";
import { Column, isColumn } from "./column.ts";
import type { AnyColumn } from "./column.ts";
import { registerTable } from "./registry.ts";
import type {
  ColumnDef,
  ConstraintDef,
  EnumDef,
  IndexDef,
  IndexMember,
  ReferentialAction,
  SequenceDef,
  TableDef,
} from "./types.ts";

export const TABLE: unique symbol = Symbol.for("flypath.table");

export type Columns = Record<string, AnyColumn>;

export type TableMeta = {
  name: string;
  schema: string | undefined;
  columns: Columns;
  order: string[];
  extras: Extra[];
  comment: string | undefined;
};

export type Table<Name extends string, Cols extends Columns> = Cols & {
  readonly [TABLE]: TableMeta & { name: Name };
};

export type AnyTable = Table<string, Columns>;

export function isTable(value: unknown): value is AnyTable {
  return (
    typeof value === "object" && value !== null && TABLE in (value as object)
  );
}

type Target = AnyColumn | Expr<unknown>;

type Member = Target | readonly [Target, "asc" | "desc"];

function memberOf(input: Member): IndexMember {
  const [target, direction] = Array.isArray(input)
    ? (input as readonly [Target, "asc" | "desc"])
    : ([input as Target, undefined] as const);

  if (isColumn(target)) {
    const member: IndexMember = {
      expression: `"${target.name}"`,
      column: target.name,
    };
    if (direction) member.direction = direction;
    return member;
  }
  const member: IndexMember = { expression: literal(target.node) };
  if (direction) member.direction = direction;
  return member;
}

function nameOf(target: Target): string {
  if (isColumn(target)) return target.name;
  throw new Error(
    "flypath: this constraint needs plain columns, not expressions",
  );
}

class IndexBuilder {
  readonly kind = "index";

  readonly def: IndexDef;

  constructor(name: string | undefined, unique: boolean) {
    this.def = { name: name ?? "", unique, members: [] };
  }

  on(...members: Member[]): this {
    this.def.members.push(...members.map(memberOf));
    return this;
  }

  using(method: string, ...members: Member[]): this {
    this.def.using = method;
    this.def.members.push(...members.map(memberOf));
    return this;
  }

  where(expression: Expr<unknown>): this {
    this.def.where = literal(expression.node);
    return this;
  }

  include(...columns: AnyColumn[]): this {
    this.def.include = columns.map((column) => column.name);
    return this;
  }

  nullsNotDistinct(): this {
    this.def.nullsNotDistinct = true;
    return this;
  }

  concurrently(): this {
    this.def.concurrently = true;
    return this;
  }
}

class ConstraintBuilder {
  readonly kind = "constraint";

  name: string;

  private readonly type: "primaryKey" | "unique" | "foreignKey";

  columns: string[] = [];

  distinct = true;

  target: { table: string; columns: string[] } | undefined;

  options: {
    onDelete?: ReferentialAction;
    onUpdate?: ReferentialAction;
    deferrable?: boolean;
  } = {};

  constructor(type: "primaryKey" | "unique" | "foreignKey", name?: string) {
    this.type = type;
    this.name = name ?? "";
  }

  on(...columns: Target[]): this {
    this.columns.push(...columns.map(nameOf));
    return this;
  }

  columnsAre(...columns: Target[]): this {
    return this.on(...columns);
  }

  nullsNotDistinct(): this {
    this.distinct = false;
    return this;
  }

  references(
    table: AnyTable | string,
    columns: (Target | string)[],
    options: {
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
      deferrable?: boolean;
    } = {},
  ): this {
    this.target = {
      table: typeof table === "string" ? table : table[TABLE].name,
      columns: columns.map((column) =>
        typeof column === "string" ? column : nameOf(column),
      ),
    };
    this.options = options;
    return this;
  }

  build(table: string): ConstraintDef {
    if (this.type === "primaryKey") {
      return {
        kind: "primaryKey",
        name: this.name || `${table}_pkey`,
        columns: this.columns,
      };
    }
    if (this.type === "unique") {
      const constraint: ConstraintDef = {
        kind: "unique",
        name: this.name || `${table}_${this.columns.join("_")}_key`,
        columns: this.columns,
      };
      if (!this.distinct) constraint.nullsNotDistinct = true;
      return constraint;
    }
    if (!this.target) {
      throw new Error("flypath: foreignKey() needs a references() target");
    }
    return {
      kind: "foreignKey",
      name: this.name || `${table}_${this.columns.join("_")}_fkey`,
      columns: this.columns,
      table: this.target.table,
      references: this.target.columns,
      ...this.options,
    };
  }
}

class CheckBuilder {
  readonly kind = "check";

  readonly name: string;

  readonly expression: string;

  constructor(name: string, expression: Expr<unknown>) {
    this.name = name;
    this.expression = literal(expression.node);
  }
}

export type Extra = IndexBuilder | ConstraintBuilder | CheckBuilder;

export function index(name?: string): IndexBuilder {
  return new IndexBuilder(name, false);
}

export function unique(name?: string): IndexBuilder {
  return new IndexBuilder(name, true);
}

export function primaryKey(name?: string): ConstraintBuilder {
  return new ConstraintBuilder("primaryKey", name);
}

export function foreignKey(name?: string): ConstraintBuilder {
  return new ConstraintBuilder("foreignKey", name);
}

export function check(name: string, expression: Expr<unknown>): CheckBuilder {
  return new CheckBuilder(name, expression);
}

export function table<const Name extends string, Cols extends Columns>(
  name: Name,
  columns: Cols,
  extras?: (t: Cols) => readonly Extra[],
): Table<Name, Cols> {
  const order = Object.keys(columns);
  for (const key of order) {
    const column = columns[key] as AnyColumn;
    column.table = name;
    column.name = key;
  }

  const meta: TableMeta = {
    name,
    schema: undefined,
    columns,
    order,
    extras: extras ? [...extras(columns)] : [],
    comment: undefined,
  };

  registerTable(name, order);

  return Object.assign(Object.create(null) as object, columns, {
    [TABLE]: meta,
  }) as Table<Name, Cols>;
}

export type EnumType<V extends string> = (() => Column<
  V | null,
  V | null,
  true
>) & { readonly enumDef: EnumDef };

export function enumColumn(
  name: string,
): Column<string | null, string | null, true> {
  return new Column<string | null, string | null, true>({
    type: name,
    enum: true,
    array: 0,
    notNull: false,
    primaryKey: false,
    unique: false,
  });
}

export function enumType<const V extends readonly string[]>(
  name: string,
  values: V,
): EnumType<V[number]> {
  const def: EnumDef = { name, values: [...values] };
  const create = (): Column<V[number] | null, V[number] | null, true> =>
    new Column<V[number] | null, V[number] | null, true>({
      type: name,
      enum: true,
      array: 0,
      notNull: false,
      primaryKey: false,
      unique: false,
    });
  return Object.assign(create, { enumDef: def });
}

export type Extension = { flypath: "extension"; name: string };

export function extension(name: string): Extension {
  return { flypath: "extension", name };
}

export type SchemaNamespace = {
  flypath: "schema";
  name: string;
  table: <const Name extends string, Cols extends Columns>(
    name: Name,
    columns: Cols,
    extras?: (t: Cols) => readonly Extra[],
  ) => Table<Name, Cols>;
};

export function schema(name: string): SchemaNamespace {
  return {
    flypath: "schema",
    name,
    table: (tableName, columns, extras) => {
      const built = table(tableName, columns, extras);
      built[TABLE].schema = name;
      return built;
    },
  };
}

export type Sequence = { flypath: "sequence" } & SequenceDef;

export function sequence(
  name: string,
  options: { type?: string; start?: number; increment?: number } = {},
): Sequence {
  return { flypath: "sequence", name, ...options };
}

export type ViewSource<Name extends string, Row> = {
  flypath: "view";
  name: Name;
  materialized: boolean;
  ir: QueryIR;
  row?: Row;
};

type Pipe<Row> = { readonly ir: QueryIR; readonly row: Row };

function columnsOfPipe(ir: QueryIR): readonly string[] {
  return queryColumns(ir) ?? [];
}

export function view<const Name extends string, Row>(
  name: Name,
  query: Pipe<Row>,
): ViewSource<Name, Row> {
  registerTable(name, columnsOfPipe(query.ir));
  return { flypath: "view", name, materialized: false, ir: query.ir };
}

export function materializedView<const Name extends string, Row>(
  name: Name,
  query: Pipe<Row>,
): ViewSource<Name, Row> {
  registerTable(name, columnsOfPipe(query.ir));
  return { flypath: "view", name, materialized: true, ir: query.ir };
}

export function defineTable<Cols extends Columns>(
  name: string,
  columns: Cols,
  extras?: (t: Cols) => readonly Extra[],
): TableDef {
  const order = Object.keys(columns);
  for (const key of order) {
    const column = columns[key] as AnyColumn;
    column.table = name;
    column.name = key;
  }
  return tableDefinition({
    name,
    schema: undefined,
    columns,
    order,
    extras: extras ? [...extras(columns)] : [],
    comment: undefined,
  });
}

export function tableDefinition(meta: TableMeta): TableDef {
  const def: TableDef = {
    name: meta.name,
    columns: {},
    order: [...meta.order],
    indexes: [],
    constraints: [],
  };
  if (meta.schema !== undefined) def.schema = meta.schema;
  if (meta.comment !== undefined) def.comment = meta.comment;

  const primary: string[] = [];

  for (const key of meta.order) {
    const column = meta.columns[key] as AnyColumn;
    column.resolve();
    const {
      primaryKey: isPrimary,
      unique: isUnique,
      check: expression,
      ...rest
    } = column.def;
    const stored: ColumnDef = {
      ...rest,
      primaryKey: false,
      unique: false,
    };
    def.columns[key] = stored;

    if (isPrimary) primary.push(key);
    if (isUnique) {
      def.constraints.push({
        kind: "unique",
        name: `${meta.name}_${key}_key`,
        columns: [key],
      });
    }
    if (expression !== undefined) {
      def.constraints.push({
        kind: "check",
        name: `${meta.name}_${key}_check`,
        expression,
      });
    }
    if (stored.references) {
      const reference = stored.references;
      const constraint: ConstraintDef = {
        kind: "foreignKey",
        name: `${meta.name}_${key}_fkey`,
        columns: [key],
        table: reference.table,
        references: [reference.column],
      };
      if (reference.onDelete) constraint.onDelete = reference.onDelete;
      if (reference.onUpdate) constraint.onUpdate = reference.onUpdate;
      if (reference.deferrable) constraint.deferrable = true;
      def.constraints.push(constraint);
      delete stored.references;
    }
  }

  if (primary.length > 0) {
    def.constraints.unshift({
      kind: "primaryKey",
      name: `${meta.name}_pkey`,
      columns: primary,
    });
  }

  for (const extra of meta.extras) {
    if (extra.kind === "check") {
      def.constraints.push({
        kind: "check",
        name: extra.name,
        expression: extra.expression,
      });
      continue;
    }
    if (extra.kind === "constraint") {
      def.constraints.push(extra.build(meta.name));
      continue;
    }
    const index = { ...extra.def };
    if (
      index.unique &&
      index.where === undefined &&
      index.using === undefined &&
      index.include === undefined &&
      index.members.every((member) => member.column !== undefined)
    ) {
      const columns = index.members.map((member) => member.column as string);
      const constraint: ConstraintDef = {
        kind: "unique",
        name: index.name || `${meta.name}_${columns.join("_")}_key`,
        columns,
      };
      if (index.nullsNotDistinct) constraint.nullsNotDistinct = true;
      def.constraints.push(constraint);
      continue;
    }
    if (index.name === "") {
      const parts = index.members.map(
        (member, position) => member.column ?? `expr${String(position + 1)}`,
      );
      index.name = `${meta.name}_${parts.join("_")}_${index.unique ? "key" : "idx"}`;
    }
    def.indexes.push(index);
  }

  def.constraints.sort((left, right) => left.name.localeCompare(right.name));
  def.indexes.sort((left, right) => left.name.localeCompare(right.name));

  return def;
}
