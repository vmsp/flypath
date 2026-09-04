import { literal } from "../db/compile.ts";
import type { Expr } from "../db/expression.ts";
import { isExpression } from "../db/expression.ts";
import type {
  ColumnDef,
  DefaultValue,
  Identity,
  ReferentialAction,
} from "./types.ts";

export type ReferenceOptions = {
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  deferrable?: boolean;
};

export type ReferenceTarget =
  | (() => Column<unknown, unknown, boolean>)
  | { table: string; column: string };

export class Column<S, I, O extends boolean> {
  readonly flypathColumn = true;

  readonly def: ColumnDef;

  reference: { target: ReferenceTarget; options: ReferenceOptions } | undefined;

  table = "";

  name = "";

  constructor(def: ColumnDef) {
    this.def = def;
  }

  private with<NS, NI, NO extends boolean>(
    patch: Partial<ColumnDef>,
  ): Column<NS, NI, NO> {
    const next = new Column<NS, NI, NO>({ ...this.def, ...patch });
    next.reference = this.reference;
    return next;
  }

  notNull(): Column<NonNullable<S>, NonNullable<I>, O> {
    return this.with<NonNullable<S>, NonNullable<I>, O>({ notNull: true });
  }

  default(value: I | Expr<unknown>): Column<S, I, true> {
    return this.with<S, I, true>({ default: defaultOf(value) });
  }

  defaultNow(): Column<S, I, true> {
    return this.with<S, I, true>({
      default: { kind: "expression", text: "now()" },
    });
  }

  primaryKey(): Column<NonNullable<S>, I, O> {
    return this.with<NonNullable<S>, I, O>({ primaryKey: true, notNull: true });
  }

  unique(): Column<S, I, O> {
    return this.with<S, I, O>({ unique: true });
  }

  references(
    target: ReferenceTarget,
    options: ReferenceOptions = {},
  ): Column<S, I, O> {
    const next = this.with<S, I, O>({});
    next.reference = { target, options };
    return next;
  }

  resolve(): void {
    if (!this.reference) return;
    const { target, options } = this.reference;
    const to =
      typeof target === "function"
        ? { table: target().table, column: target().name }
        : target;
    this.def.references = { ...to, ...options };
  }

  generatedAlwaysAsIdentity(
    options: { start?: number; increment?: number } = {},
  ): Column<NonNullable<S>, never, true> {
    const identity: Identity = { always: true, ...options };
    return this.with<NonNullable<S>, never, true>({ identity, notNull: true });
  }

  generatedByDefaultAsIdentity(
    options: { start?: number; increment?: number } = {},
  ): Column<NonNullable<S>, NonNullable<I>, true> {
    const identity: Identity = { always: false, ...options };
    return this.with<NonNullable<S>, NonNullable<I>, true>({
      identity,
      notNull: true,
    });
  }

  generatedAlwaysAs(expression: Expr<unknown>): Column<S, never, true> {
    return this.with<S, never, true>({ generated: literal(expression.node) });
  }

  collate(collation: string): Column<S, I, O> {
    return this.with<S, I, O>({ collate: collation });
  }

  check(expression: Expr<unknown>): Column<S, I, O> {
    return this.with<S, I, O>({ check: literal(expression.node) });
  }

  comment(text: string): Column<S, I, O> {
    return this.with<S, I, O>({ comment: text });
  }

  array(): Column<NonNullable<S>[] | null, NonNullable<I>[] | null, O> {
    return this.with<NonNullable<S>[] | null, NonNullable<I>[] | null, O>({
      array: this.def.array + 1,
    });
  }
}

export type AnyColumn = Column<unknown, unknown, boolean>;

export function isColumn(value: unknown): value is AnyColumn {
  return (
    typeof value === "object" && value !== null && "flypathColumn" in value
  );
}

function defaultOf(value: unknown): DefaultValue {
  if (isExpression(value)) {
    return { kind: "expression", text: literal(value.node) };
  }
  return { kind: "value", value };
}

function make<S>(type: string): Column<S | null, S | null, true> {
  return new Column<S | null, S | null, true>({
    type,
    array: 0,
    notNull: false,
    primaryKey: false,
    unique: false,
  });
}

type Nullish<T> = Column<T | null, T | null, true>;

export function smallint(): Nullish<number> {
  return make<number>("smallint");
}

export function integer(): Nullish<number> {
  return make<number>("integer");
}

export function bigint(options?: { mode?: "number" }): Nullish<number>;
export function bigint(options: { mode: "bigint" }): Nullish<bigint>;
export function bigint(options: { mode?: "number" | "bigint" } = {}): unknown {
  return options.mode === "bigint"
    ? make<bigint>("bigint")
    : make<number>("bigint");
}

export function real(): Nullish<number> {
  return make<number>("real");
}

export function doublePrecision(): Nullish<number> {
  return make<number>("double precision");
}

export function numeric(precision?: number, scale?: number): Nullish<string> {
  const type =
    precision === undefined
      ? "numeric"
      : scale === undefined
        ? `numeric(${String(precision)})`
        : `numeric(${String(precision)}, ${String(scale)})`;
  return make<string>(type);
}

export function money(): Nullish<string> {
  return make<string>("money");
}

export function boolean(): Nullish<boolean> {
  return make<boolean>("boolean");
}

export function text(): Nullish<string> {
  return make<string>("text");
}

export function varchar(length?: number): Nullish<string> {
  return make<string>(
    length === undefined ? "varchar" : `varchar(${String(length)})`,
  );
}

export function char(length?: number): Nullish<string> {
  return make<string>(
    length === undefined ? "char" : `char(${String(length)})`,
  );
}

export function bytea(): Nullish<Uint8Array> {
  return make<Uint8Array>("bytea");
}

export function timestamptz(precision?: number): Nullish<Date> {
  return make<Date>(
    precision === undefined
      ? "timestamptz"
      : `timestamptz(${String(precision)})`,
  );
}

export function timestamp(precision?: number): Nullish<Date> {
  return make<Date>(
    precision === undefined ? "timestamp" : `timestamp(${String(precision)})`,
  );
}

export function date(): Nullish<string> {
  return make<string>("date");
}

export function time(precision?: number): Nullish<string> {
  return make<string>(
    precision === undefined ? "time" : `time(${String(precision)})`,
  );
}

export function timetz(precision?: number): Nullish<string> {
  return make<string>(
    precision === undefined ? "timetz" : `timetz(${String(precision)})`,
  );
}

export function interval(): Nullish<string> {
  return make<string>("interval");
}

export function uuid(): Nullish<string> {
  return make<string>("uuid");
}

export function json<T = unknown>(): Nullish<T> {
  return make<T>("json");
}

export function jsonb<T = unknown>(): Nullish<T> {
  return make<T>("jsonb");
}

export function inet(): Nullish<string> {
  return make<string>("inet");
}

export function cidr(): Nullish<string> {
  return make<string>("cidr");
}

export function macaddr(): Nullish<string> {
  return make<string>("macaddr");
}

export function int4range(): Nullish<string> {
  return make<string>("int4range");
}

export function int8range(): Nullish<string> {
  return make<string>("int8range");
}

export function numrange(): Nullish<string> {
  return make<string>("numrange");
}

export function tsrange(): Nullish<string> {
  return make<string>("tsrange");
}

export function tstzrange(): Nullish<string> {
  return make<string>("tstzrange");
}

export function daterange(): Nullish<string> {
  return make<string>("daterange");
}

export function tsvector(): Nullish<string> {
  return make<string>("tsvector");
}

export function bit(length?: number): Nullish<string> {
  return make<string>(length === undefined ? "bit" : `bit(${String(length)})`);
}

export function varbit(length?: number): Nullish<string> {
  return make<string>(
    length === undefined ? "varbit" : `varbit(${String(length)})`,
  );
}

export function point(): Nullish<{ x: number; y: number }> {
  return make<{ x: number; y: number }>("point");
}

export function custom<T>(sqlType: string): Nullish<T> {
  return make<T>(sqlType);
}
