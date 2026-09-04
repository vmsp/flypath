import type { Node, OrderTerm, QueryIR, WindowSpec } from "./ir.ts";

export class Expr<T> {
  readonly flypathExpression = true;

  declare readonly $type?: T;

  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  as<A extends string>(alias: A): Aliased<T, A> {
    return new Aliased<T, A>(this.node, alias);
  }
}

export class Aliased<T, A extends string> {
  readonly flypathAliased = true;

  declare readonly $type?: T;

  readonly node: Node;

  readonly alias: A;

  constructor(node: Node, alias: A) {
    this.node = node;
    this.alias = alias;
  }
}

export class WindowFn<T> extends Expr<T> {
  over(spec: {
    partitionBy?: OrderInput | readonly OrderInput[];
    orderBy?: OrderInput | readonly OrderInput[];
    frame?: string;
  }): Expr<T> {
    const window: WindowSpec = {};
    if (spec.partitionBy !== undefined) {
      window.partitionBy = orderList(spec.partitionBy).map((term) => term.node);
    }
    if (spec.orderBy !== undefined) window.orderBy = orderList(spec.orderBy);
    if (spec.frame !== undefined) window.frame = spec.frame;
    return new Expr<T>({ kind: "window", fn: this.node, spec: window });
  }
}

export type Expression<T> = Expr<T>;

export type OrderInput =
  | string
  | Expr<unknown>
  | readonly [string | Expr<unknown>, "asc" | "desc"]
  | readonly [string | Expr<unknown>, "asc" | "desc", "first" | "last"];

export function isExpression(value: unknown): value is Expr<unknown> {
  return (
    typeof value === "object" && value !== null && "flypathExpression" in value
  );
}

function isAliased(value: unknown): value is Aliased<unknown, string> {
  return (
    typeof value === "object" && value !== null && "flypathAliased" in value
  );
}

export function orderList(
  input: OrderInput | readonly OrderInput[],
): OrderTerm[] {
  if (isOrderTuple(input)) return [orderTerm(input as OrderInput)];
  const items = Array.isArray(input)
    ? (input as readonly OrderInput[])
    : [input as OrderInput];
  return items.map((item) => orderTerm(item));
}

function isOrderTuple(input: unknown): boolean {
  return (
    Array.isArray(input) &&
    (input.length === 2 || input.length === 3) &&
    (input[1] === "asc" || input[1] === "desc")
  );
}

function orderTerm(input: OrderInput): OrderTerm {
  if (isOrderTuple(input)) {
    const [target, direction, nulls] = input as readonly [
      string | Expr<unknown>,
      "asc" | "desc",
      ("first" | "last")?,
    ];
    const term: OrderTerm = { node: targetNode(target), direction };
    if (nulls !== undefined) term.nulls = nulls;
    return term;
  }
  return { node: targetNode(input as string | Expr<unknown>) };
}

function targetNode(target: string | Expr<unknown>): Node {
  return typeof target === "string"
    ? { kind: "ref", name: target }
    : target.node;
}

function refProxy(name: string): Expr<unknown> {
  return new Proxy(new Expr<unknown>({ kind: "ref", name }), {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target)) {
        return refProxy(`${name}.${property}`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

export function isPipe(value: unknown): value is { ir: QueryIR } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ir" in value &&
    typeof (value as { ir: unknown }).ir === "object"
  );
}

export function toNode(value: unknown): Node {
  if (isExpression(value) || isAliased(value)) return value.node;
  if (isPipe(value)) return { kind: "query", query: value.ir };
  return { kind: "value", value };
}

export function predicateNode(
  column: string,
  operator: string,
  value: unknown,
): Node {
  const left: Node = { kind: "ref", name: column };

  if (operator === "in" || operator === "not in") {
    if (isPipe(value)) {
      return {
        kind: "binary",
        op: operator,
        left,
        right: { kind: "query", query: value.ir },
      };
    }
    return {
      kind: "binary",
      op: operator === "in" ? "=" : "<>",
      left,
      right: {
        kind: "call",
        name: operator === "in" ? "any" : "all",
        args: [toNode(value)],
      },
    };
  }

  if (operator === "between") {
    const [low, high] = value as readonly [unknown, unknown];
    return {
      kind: "binary",
      op: "between",
      left,
      right: {
        kind: "fragment",
        parts: ["", " and ", ""],
        values: [toNode(low), toNode(high)],
      },
    };
  }

  if (operator === "is" || operator === "is not") {
    const text = value === null ? "null" : value === true ? "true" : "false";
    return { kind: "binary", op: operator, left, right: { kind: "raw", text } };
  }

  return { kind: "binary", op: operator, left, right: toNode(value) };
}

export function scopeProxy(): Record<string, Expr<unknown>> {
  return new Proxy(Object.create(null) as Record<string, Expr<unknown>>, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return refProxy(property);
    },
    has() {
      return true;
    },
  });
}
