import type {
  ColumnDef,
  ConstraintDef,
  IndexDef,
  TableDef,
} from "../schema/types.ts";
import type { Operation } from "./operations.ts";
import { compactOrder } from "./order.ts";

const SCHEMA_MODULE = "flypath/schema";

const MIGRATIONS_MODULE = "flypath/migrations";

const SIMPLE: Record<string, string> = {
  smallint: "smallint",
  integer: "integer",
  bigint: "bigint",
  real: "real",
  "double precision": "doublePrecision",
  numeric: "numeric",
  money: "money",
  boolean: "boolean",
  text: "text",
  varchar: "varchar",
  char: "char",
  bytea: "bytea",
  timestamptz: "timestamptz",
  timestamp: "timestamp",
  date: "date",
  time: "time",
  timetz: "timetz",
  interval: "interval",
  uuid: "uuid",
  json: "json",
  jsonb: "jsonb",
  inet: "inet",
  cidr: "cidr",
  macaddr: "macaddr",
  int4range: "int4range",
  int8range: "int8range",
  numrange: "numrange",
  tsrange: "tsrange",
  tstzrange: "tstzrange",
  daterange: "daterange",
  tsvector: "tsvector",
  bit: "bit",
  varbit: "varbit",
  point: "point",
};

function quoted(value: string): string {
  return JSON.stringify(value);
}

function template(text: string): string {
  return `sql\`${text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
}

class Writer {
  readonly schemaImports = new Set<string>();

  readonly migrationImports = new Set<string>();

  private schema(name: string): string {
    this.schemaImports.add(name);
    return name;
  }

  private operation(name: string): string {
    this.migrationImports.add(name);
    return name;
  }

  column(def: ColumnDef, inline: readonly string[] = []): string {
    let text = this.constructor_(def);
    for (let depth = 0; depth < def.array; depth += 1) text += ".array()";
    text += inline.join("");
    if (def.notNull && !inline.includes(".primaryKey()") && !def.identity) {
      text += ".notNull()";
    }
    if (def.identity) {
      const options: string[] = [];
      if (def.identity.start !== undefined) {
        options.push(`start: ${String(def.identity.start)}`);
      }
      if (def.identity.increment !== undefined) {
        options.push(`increment: ${String(def.identity.increment)}`);
      }
      const argument = options.length > 0 ? `{ ${options.join(", ")} }` : "";
      text += def.identity.always
        ? `.generatedAlwaysAsIdentity(${argument})`
        : `.generatedByDefaultAsIdentity(${argument})`;
    }
    if (def.generated) {
      this.schema("sql");
      text += `.generatedAlwaysAs(${template(def.generated)})`;
    }
    if (def.default !== undefined) {
      if (def.default.kind === "expression") {
        text +=
          def.default.text === "now()"
            ? ".defaultNow()"
            : `.default(${template(def.default.text)})`;
        if (def.default.text !== "now()") this.schemaImports.add("sql");
      } else {
        text += `.default(${JSON.stringify(def.default.value)})`;
      }
    }
    if (def.collate) text += `.collate(${quoted(def.collate)})`;
    if (def.comment !== undefined) text += `.comment(${quoted(def.comment)})`;
    return text;
  }

  private constructor_(def: ColumnDef): string {
    if (def.enum) return `${this.schema("enumColumn")}(${quoted(def.type)})`;
    const at = def.type.indexOf("(");
    const base = at === -1 ? def.type : def.type.slice(0, at);
    const args = at === -1 ? "" : def.type.slice(at + 1, -1);
    const builder = SIMPLE[base];
    if (builder === undefined) {
      return `${this.schema("custom")}(${quoted(def.type)})`;
    }
    return `${this.schema(builder)}(${args})`;
  }

  table(table: TableDef): string {
    const inline = new Map<string, string[]>();
    const extras: ConstraintDef[] = [];

    for (const constraint of table.constraints) {
      const single =
        constraint.kind !== "check" && constraint.columns.length === 1;
      const column = single ? (constraint.columns[0] as string) : "";
      if (
        constraint.kind === "primaryKey" &&
        single &&
        constraint.name === `${table.name}_pkey`
      ) {
        push(inline, column, ".primaryKey()");
        continue;
      }
      if (
        constraint.kind === "unique" &&
        single &&
        !constraint.nullsNotDistinct &&
        constraint.name === `${table.name}_${column}_key`
      ) {
        push(inline, column, ".unique()");
        continue;
      }
      if (
        constraint.kind === "foreignKey" &&
        single &&
        constraint.references.length === 1 &&
        constraint.name === `${table.name}_${column}_fkey`
      ) {
        const options: string[] = [];
        if (constraint.onDelete) {
          options.push(`onDelete: ${quoted(constraint.onDelete)}`);
        }
        if (constraint.onUpdate) {
          options.push(`onUpdate: ${quoted(constraint.onUpdate)}`);
        }
        if (constraint.deferrable) options.push("deferrable: true");
        const target = `{ table: ${quoted(constraint.table)}, column: ${quoted(
          constraint.references[0] as string,
        )} }`;
        push(
          inline,
          column,
          `.references(${target}${options.length > 0 ? `, { ${options.join(", ")} }` : ""})`,
        );
        continue;
      }
      if (
        constraint.kind === "check" &&
        table.order.some(
          (name) => constraint.name === `${table.name}_${name}_check`,
        )
      ) {
        const owner = table.order.find(
          (name) => constraint.name === `${table.name}_${name}_check`,
        ) as string;
        this.schemaImports.add("sql");
        push(inline, owner, `.check(${template(constraint.expression)})`);
        continue;
      }
      extras.push(constraint);
    }

    const order = compactOrder(table);
    const columns = order
      .map((name) => {
        return `    ${property(name)}: ${this.column(
          table.columns[name] as ColumnDef,
          inline.get(name) ?? [],
        )},`;
      })
      .join("\n");

    const parts = [
      `${this.operation("createTable")}(${quoted(table.name)}, {\n${columns}\n  }`,
    ];

    const extraLines = [
      ...extras.map((constraint) => this.constraint(table, constraint)),
      ...table.indexes.map((index) => this.index(table, index)),
    ].filter((line) => line !== undefined);

    if (extraLines.length > 0) {
      parts.push(`, (t) => [\n    ${extraLines.join(",\n    ")},\n  ]`);
    }
    parts.push(")");
    return parts.join("");
  }

  private constraint(
    table: TableDef,
    constraint: ConstraintDef,
  ): string | undefined {
    const members = (columns: readonly string[]): string =>
      columns.map((name) => `t${access(name)}`).join(", ");

    switch (constraint.kind) {
      case "primaryKey":
        return `${this.schema("primaryKey")}().on(${members(constraint.columns)})`;
      case "unique": {
        const auto = `${table.name}_${constraint.columns.join("_")}_key`;
        const name = constraint.name === auto ? "" : quoted(constraint.name);
        const suffix = constraint.nullsNotDistinct ? ".nullsNotDistinct()" : "";
        return `${this.schema("unique")}(${name}).on(${members(
          constraint.columns,
        )})${suffix}`;
      }
      case "check":
        this.schemaImports.add("sql");
        return `${this.schema("check")}(${quoted(constraint.name)}, ${template(
          constraint.expression,
        )})`;
      case "foreignKey": {
        const auto = `${table.name}_${constraint.columns.join("_")}_fkey`;
        const name = constraint.name === auto ? "" : quoted(constraint.name);
        const options: string[] = [];
        if (constraint.onDelete) {
          options.push(`onDelete: ${quoted(constraint.onDelete)}`);
        }
        if (constraint.onUpdate) {
          options.push(`onUpdate: ${quoted(constraint.onUpdate)}`);
        }
        if (constraint.deferrable) options.push("deferrable: true");
        const references = `[${constraint.references
          .map((column) => quoted(column))
          .join(", ")}]`;
        return (
          `${this.schema("foreignKey")}(${name}).on(${members(constraint.columns)})` +
          `.references(${quoted(constraint.table)}, ${references}` +
          `${options.length > 0 ? `, { ${options.join(", ")} }` : ""})`
        );
      }
    }
  }

  private index(table: TableDef, index: IndexDef): string {
    const auto = `${table.name}_${index.members
      .map((member, at) => member.column ?? `expr${String(at + 1)}`)
      .join("_")}_${index.unique ? "key" : "idx"}`;
    const name = index.name === auto ? "" : quoted(index.name);
    const members = index.members.map((member) => {
      const target = member.column
        ? `t${access(member.column)}`
        : (this.schemaImports.add("sql"), template(member.expression));
      return member.direction
        ? `[${target}, ${quoted(member.direction)}]`
        : target;
    });

    let text = `${this.schema(index.unique ? "unique" : "index")}(${name})`;
    text += index.using
      ? `.using(${quoted(index.using)}, ${members.join(", ")})`
      : `.on(${members.join(", ")})`;
    if (index.include && index.include.length > 0) {
      text += `.include(${index.include.map((column) => `t${access(column)}`).join(", ")})`;
    }
    if (index.nullsNotDistinct) text += ".nullsNotDistinct()";
    if (index.where !== undefined) {
      this.schemaImports.add("sql");
      text += `.where(${template(index.where)})`;
    }
    if (index.concurrently) text += ".concurrently()";
    return text;
  }

  operationText(operation: Operation): string {
    switch (operation.kind) {
      case "createTable":
        return this.table(operation.table);
      case "dropTable":
        return `${this.operation("dropTable")}(${quoted(operation.name)})`;
      case "renameTable":
        return `${this.operation("renameTable")}(${quoted(
          operation.from,
        )}, ${quoted(operation.to)})`;
      case "addColumn":
        return `${this.operation("addColumn")}(${quoted(
          operation.table,
        )}, ${quoted(operation.name)}, ${this.column(operation.column)})`;
      case "dropColumn":
        return `${this.operation("dropColumn")}(${quoted(
          operation.table,
        )}, ${quoted(operation.name)})`;
      case "renameColumn":
        return `${this.operation("renameColumn")}(${quoted(
          operation.table,
        )}, ${quoted(operation.from)}, ${quoted(operation.to)})`;
      case "alterColumn":
        return `${this.operation("alterColumn")}(${quoted(
          operation.table,
        )}, ${quoted(operation.name)}, ${json(operation.change)})`;
      case "createIndex":
        return `${this.operation("createIndex")}(${quoted(
          operation.table,
        )}, ${json(operation.index)})`;
      case "dropIndex":
        return `${this.operation("dropIndex")}(${quoted(
          operation.table,
        )}, ${quoted(operation.name)})`;
      case "addConstraint":
        return `${this.operation("addConstraint")}(${quoted(
          operation.table,
        )}, ${json(operation.constraint)})`;
      case "dropConstraint":
        return `${this.operation("dropConstraint")}(${quoted(
          operation.table,
        )}, ${quoted(operation.name)})`;
      case "createEnum":
        return `${this.operation("createEnum")}(${quoted(operation.name)}, ${json(
          operation.values,
        )})`;
      case "addEnumValue": {
        const position =
          operation.before !== undefined
            ? `, { before: ${quoted(operation.before)} }`
            : operation.after !== undefined
              ? `, { after: ${quoted(operation.after)} }`
              : "";
        return `${this.operation("addEnumValue")}(${quoted(
          operation.name,
        )}, ${quoted(operation.value)}${position})`;
      }
      case "renameEnumValue":
        return `${this.operation("renameEnumValue")}(${quoted(
          operation.name,
        )}, ${quoted(operation.from)}, ${quoted(operation.to)})`;
      case "dropEnum":
        return `${this.operation("dropEnum")}(${quoted(operation.name)})`;
      case "createExtension":
        return `${this.operation("createExtension")}(${quoted(operation.name)})`;
      case "dropExtension":
        return `${this.operation("dropExtension")}(${quoted(operation.name)})`;
      case "createSchema":
        return `${this.operation("createSchema")}(${quoted(operation.name)})`;
      case "dropSchema":
        return `${this.operation("dropSchema")}(${quoted(operation.name)})`;
      case "createSequence":
        return `${this.operation("createSequence")}(${json(operation.sequence)})`;
      case "dropSequence":
        return `${this.operation("dropSequence")}(${quoted(operation.name)})`;
      case "createView":
        return `${this.operation(
          operation.view.materialized ? "createMaterializedView" : "createView",
        )}(${json(operation.view)})`;
      case "dropView":
        return `${this.operation(
          operation.materialized ? "dropMaterializedView" : "dropView",
        )}(${quoted(operation.name)})`;
      case "sql":
        return `${this.operation("sql")}(${json({
          up: operation.up,
          ...(operation.down === undefined ? {} : { down: operation.down }),
        })})`;
      case "run":
        return `${this.operation("run")}({ up: async () => {} })`;
    }
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function property(name: string): string {
  return IDENTIFIER.test(name) ? name : quoted(name);
}

function access(name: string): string {
  return IDENTIFIER.test(name) ? `.${name}` : `[${quoted(name)}]`;
}

function json(value: unknown): string {
  const compact = JSON.stringify(value);
  if (compact.length <= 68) return compact;
  return JSON.stringify(value, null, 2).replaceAll("\n", "\n  ");
}

export function migrationSource(operations: readonly Operation[]): string {
  const writer = new Writer();
  writer.migrationImports.add("migration");
  const body = operations
    .map((operation) => `  ${writer.operationText(operation)},`)
    .join("\n");

  const imports: string[] = [];
  const migrationNames = [...writer.migrationImports].sort();
  imports.push(
    `import { ${migrationNames.join(", ")} } from ${quoted(MIGRATIONS_MODULE)};`,
  );
  if (writer.schemaImports.size > 0) {
    const schemaNames = [...writer.schemaImports].filter(
      (name) => name !== "sql",
    );
    if (schemaNames.length > 0) {
      imports.push(
        `import { ${schemaNames.sort().join(", ")} } from ${quoted(SCHEMA_MODULE)};`,
      );
    }
    if (writer.schemaImports.has("sql")) {
      imports.unshift(`import { sql } from ${quoted("flypath")};`);
    }
  }

  return `${imports.join("\n")}\n\nexport default migration([\n${body}\n]);\n`;
}

export function migrationName(operations: readonly Operation[]): string {
  const first =
    operations.find((operation) => operation.kind !== "createEnum") ??
    operations[0];
  if (!first) return "empty";
  switch (first.kind) {
    case "createTable":
      return `create_${first.table.name}`;
    case "dropTable":
      return `drop_${first.name}`;
    case "addColumn":
      return `add_${first.table}_${first.name}`;
    case "dropColumn":
      return `remove_${first.table}_${first.name}`;
    case "renameColumn":
      return `rename_${first.table}_${first.from}`;
    case "renameTable":
      return `rename_${first.from}`;
    case "alterColumn":
      return `alter_${first.table}_${first.name}`;
    case "createIndex":
      return `index_${first.table}`;
    case "createEnum":
      return `create_enum_${first.name}`;
    default:
      return "migration";
  }
}

export function timestamp(now: Date = new Date()): string {
  const pad = (value: number, size: number = 2): string =>
    String(value).padStart(size, "0");
  return (
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}
