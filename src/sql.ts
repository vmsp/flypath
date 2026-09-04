import { Expr, WindowFn, isPipe, toNode } from "./db/expression.ts";
import type { Aliased, Expression, OrderInput } from "./db/expression.ts";
import { orderList } from "./db/expression.ts";
import type { Node, OrderTerm, QueryIR } from "./db/ir.ts";

export type { Expression } from "./db/expression.ts";
export type { Aliased } from "./db/expression.ts";

type Operand<T> = T | Expression<T> | { ir: QueryIR };

function node(value: unknown): Node {
  return toNode(value);
}

function binary<T>(op: string, left: unknown, right: unknown): Expr<T> {
  return new Expr<T>({
    kind: "binary",
    op,
    left: node(left),
    right: node(right),
  });
}

function fn<T>(name: string, args: readonly unknown[]): Expr<T> {
  return new Expr<T>({ kind: "call", name, args: args.map(node) });
}

export function and(...operands: Expression<unknown>[]): Expression<boolean> {
  return combine("and", operands);
}

export function or(...operands: Expression<unknown>[]): Expression<boolean> {
  return combine("or", operands);
}

function combine(
  op: string,
  operands: readonly Expression<unknown>[],
): Expression<boolean> {
  if (operands.length === 0) {
    return new Expr<boolean>({
      kind: "raw",
      text: op === "and" ? "true" : "false",
    });
  }
  return operands
    .slice(1)
    .reduce<Expr<boolean>>(
      (left, right) => binary<boolean>(op, left, right),
      operands[0] as Expr<boolean>,
    );
}

export function not(operand: Expression<unknown>): Expression<boolean> {
  return new Expr<boolean>({
    kind: "prefix",
    op: "not",
    operand: operand.node,
  });
}

export function eq<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("=", left, right);
}

export function ne<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("<>", left, right);
}

export function lt<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("<", left, right);
}

export function lte<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("<=", left, right);
}

export function gt<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>(">", left, right);
}

export function gte<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>(">=", left, right);
}

export function isNull(operand: Expression<unknown>): Expression<boolean> {
  return new Expr<boolean>({
    kind: "postfix",
    op: "is null",
    operand: operand.node,
  });
}

export function isNotNull(operand: Expression<unknown>): Expression<boolean> {
  return new Expr<boolean>({
    kind: "postfix",
    op: "is not null",
    operand: operand.node,
  });
}

export function isDistinctFrom<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("is distinct from", left, right);
}

export function like(
  left: Operand<string>,
  pattern: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("like", left, pattern);
}

export function ilike(
  left: Operand<string>,
  pattern: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("ilike", left, pattern);
}

export function notLike(
  left: Operand<string>,
  pattern: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("not like", left, pattern);
}

export function notIlike(
  left: Operand<string>,
  pattern: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("not ilike", left, pattern);
}

export function matches(
  left: Operand<string>,
  pattern: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("~", left, pattern);
}

export function between<T>(
  operand: Operand<T>,
  low: Operand<T>,
  high: Operand<T>,
): Expression<boolean> {
  return new Expr<boolean>({
    kind: "binary",
    op: "between",
    left: node(operand),
    right: {
      kind: "fragment",
      parts: ["", " and ", ""],
      values: [node(low), node(high)],
    },
  });
}

export function isIn<T>(
  operand: Operand<T>,
  values: readonly T[] | Expression<readonly T[]> | { ir: QueryIR },
): Expression<boolean> {
  if (isPipe(values)) return binary<boolean>("in", operand, values);
  return binary<boolean>("=", operand, fn("any", [values]));
}

export function notIn<T>(
  operand: Operand<T>,
  values: readonly T[] | Expression<readonly T[]> | { ir: QueryIR },
): Expression<boolean> {
  if (isPipe(values)) return binary<boolean>("not in", operand, values);
  return binary<boolean>("<>", operand, fn("all", [values]));
}

export function exists(query: { ir: QueryIR }): Expression<boolean> {
  return new Expr<boolean>({ kind: "exists", query: query.ir, negated: false });
}

export function notExists(query: { ir: QueryIR }): Expression<boolean> {
  return new Expr<boolean>({ kind: "exists", query: query.ir, negated: true });
}

export function contains<T>(
  left: Operand<T>,
  right: Operand<unknown>,
): Expression<boolean> {
  return binary<boolean>("@>", left, right);
}

export function containedBy<T>(
  left: Operand<T>,
  right: Operand<unknown>,
): Expression<boolean> {
  return binary<boolean>("<@", left, right);
}

export function overlaps<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<boolean> {
  return binary<boolean>("&&", left, right);
}

export function hasKey(
  left: Operand<unknown>,
  key: Operand<string>,
): Expression<boolean> {
  return binary<boolean>("?", left, key);
}

export function cast<T>(operand: unknown, type: string): Expression<T> {
  return new Expr<T>({ kind: "cast", operand: node(operand), type });
}

export function coalesce<T>(...operands: Operand<T>[]): Expression<T> {
  return fn<T>("coalesce", operands);
}

export function nullif<T>(
  left: Operand<T>,
  right: Operand<T>,
): Expression<T | null> {
  return fn<T | null>("nullif", [left, right]);
}

export function greatest<T>(...operands: Operand<T>[]): Expression<T> {
  return fn<T>("greatest", operands);
}

export function least<T>(...operands: Operand<T>[]): Expression<T> {
  return fn<T>("least", operands);
}

export function concat(...operands: Operand<string>[]): Expression<string> {
  return fn<string>("concat", operands);
}

export function lower(operand: Operand<string>): Expression<string> {
  return fn<string>("lower", [operand]);
}

export function upper(operand: Operand<string>): Expression<string> {
  return fn<string>("upper", [operand]);
}

export function trim(operand: Operand<string>): Expression<string> {
  return fn<string>("trim", [operand]);
}

export function length(operand: Operand<string>): Expression<number> {
  return fn<number>("length", [operand]);
}

export function replace(
  operand: Operand<string>,
  from: Operand<string>,
  to: Operand<string>,
): Expression<string> {
  return fn<string>("replace", [operand, from, to]);
}

export function abs(operand: Operand<number>): Expression<number> {
  return fn<number>("abs", [operand]);
}

export function round(
  operand: Operand<number>,
  digits?: Operand<number>,
): Expression<number> {
  return fn<number>(
    "round",
    digits === undefined ? [operand] : [operand, digits],
  );
}

export function now(): Expression<Date> {
  return new Expr<Date>({ kind: "raw", text: "now()" });
}

export function currentDate(): Expression<string> {
  return new Expr<string>({ kind: "raw", text: "current_date" });
}

export function excluded(column: string): Expression<unknown> {
  return new Expr<unknown>({
    kind: "identifier",
    parts: ["excluded", column],
  });
}

type Aggregate<T> = Expr<T> & {
  filter: (predicate: Expression<unknown>) => Expr<T>;
};

function aggregate<T>(
  name: string,
  args: readonly unknown[],
  options: { distinct?: boolean; orderBy?: readonly OrderTerm[] } = {},
): Expr<T> {
  const call: Node = {
    kind: "call",
    name,
    args: args.map(node),
    ...(options.distinct ? { distinct: true } : {}),
    ...(options.orderBy ? { orderBy: options.orderBy } : {}),
  };
  return new Expr<T>(call);
}

export function count(
  operand?: Expression<unknown>,
  options: { distinct?: boolean } = {},
): Expression<number> {
  if (operand === undefined) {
    return new Expr<number>({
      kind: "call",
      name: "count",
      args: [{ kind: "star" }],
    });
  }
  return aggregate<number>("count", [operand], options);
}

export function sum(operand: Expression<number>): Expression<number> {
  return aggregate<number>("sum", [operand]);
}

export function avg(operand: Expression<number>): Expression<number> {
  return aggregate<number>("avg", [operand]);
}

export function min<T>(operand: Expression<T>): Expression<T> {
  return aggregate<T>("min", [operand]);
}

export function max<T>(operand: Expression<T>): Expression<T> {
  return aggregate<T>("max", [operand]);
}

export function boolAnd(operand: Expression<boolean>): Expression<boolean> {
  return aggregate<boolean>("bool_and", [operand]);
}

export function boolOr(operand: Expression<boolean>): Expression<boolean> {
  return aggregate<boolean>("bool_or", [operand]);
}

export function arrayAgg<T>(
  operand: Expression<T>,
  options: { distinct?: boolean; orderBy?: OrderInput | OrderInput[] } = {},
): Expression<T[]> {
  return aggregate<T[]>("array_agg", [operand], {
    ...(options.distinct === undefined ? {} : { distinct: options.distinct }),
    ...(options.orderBy === undefined
      ? {}
      : { orderBy: orderList(options.orderBy) }),
  });
}

export function stringAgg(
  operand: Expression<string>,
  separator: string,
  options: { orderBy?: OrderInput | OrderInput[] } = {},
): Expression<string> {
  return aggregate<string>("string_agg", [operand, separator], {
    ...(options.orderBy === undefined
      ? {}
      : { orderBy: orderList(options.orderBy) }),
  });
}

type PipeOf<Row> = { readonly ir: QueryIR; readonly row: Row };

export function jsonAgg<Row>(query: PipeOf<Row>): Expression<Row[]> {
  return new Expr<Row[]>({
    kind: "fragment",
    parts: [
      "(select coalesce(json_agg(row_to_json(_j)), '[]'::json) from ",
      " as _j)",
    ],
    values: [{ kind: "query", query: query.ir }],
  });
}

export function jsonObject<Row>(query: PipeOf<Row>): Expression<Row | null> {
  return new Expr<Row | null>({
    kind: "fragment",
    parts: ["(select row_to_json(_j) from ", " as _j limit 1)"],
    values: [{ kind: "query", query: query.ir }],
  });
}

function window<T>(name: string, args: readonly unknown[] = []): WindowFn<T> {
  return new WindowFn<T>({ kind: "call", name, args: args.map(node) });
}

export function rowNumber(): WindowFn<number> {
  return window<number>("row_number");
}

export function rank(): WindowFn<number> {
  return window<number>("rank");
}

export function denseRank(): WindowFn<number> {
  return window<number>("dense_rank");
}

export function percentRank(): WindowFn<number> {
  return window<number>("percent_rank");
}

export function ntile(buckets: number): WindowFn<number> {
  return window<number>("ntile", [buckets]);
}

export function lag<T>(operand: Expression<T>, offset = 1): WindowFn<T | null> {
  return window<T | null>("lag", [operand, offset]);
}

export function lead<T>(
  operand: Expression<T>,
  offset = 1,
): WindowFn<T | null> {
  return window<T | null>("lead", [operand, offset]);
}

export function firstValue<T>(operand: Expression<T>): WindowFn<T> {
  return window<T>("first_value", [operand]);
}

export function lastValue<T>(operand: Expression<T>): WindowFn<T> {
  return window<T>("last_value", [operand]);
}

export function over<T>(
  operand: Expression<T>,
  spec: {
    partitionBy?: OrderInput | readonly OrderInput[];
    orderBy?: OrderInput | readonly OrderInput[];
    frame?: string;
  },
): Expression<T> {
  return new WindowFn<T>(operand.node).over(spec);
}

export function caseWhen<T>(
  branches: readonly { when: Expression<unknown>; then: Operand<T> }[],
  fallback?: Operand<T>,
): Expression<T> {
  return new Expr<T>({
    kind: "case",
    branches: branches.map((branch) => ({
      when: branch.when.node,
      then: node(branch.then),
    })),
    ...(fallback === undefined ? {} : { fallback: node(fallback) }),
  });
}

export type { Aggregate };
export type { Aliased as AliasedExpression };
export type AnyAliased = Aliased<unknown, string>;
