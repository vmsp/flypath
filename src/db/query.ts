import { execute, stream } from "./client.ts";
import { compileQuery } from "./compile.ts";
import type { Aliased, OrderInput } from "./expression.ts";
import {
  Expr,
  orderList,
  predicateNode,
  scopeProxy,
  toNode,
} from "./expression.ts";
import type {
  Compiled,
  Cte,
  JoinKind,
  Node,
  Projection,
  QueryIR,
  SetOp,
  Source,
  Step,
} from "./ir.ts";
import { Delete, InsertTarget, Update } from "./mutate.ts";
import type {
  Aggregated,
  Dropped,
  Extended,
  Merge,
  Names,
  Nullify,
  Operand,
  Operator,
  Output,
  Refs,
  Renamed,
  Scope,
  Selected,
  SelectKey,
  Simplify,
} from "./scope.ts";
import { Fragment, NotFoundError } from "./sql.ts";
import type { Row, TableName, TableRow } from "./types.ts";

type Predicate = Expr<unknown> | Aliased<unknown, string>;

export type AnyPipe = { readonly ir: QueryIR };

export type Pipe<Row> = { readonly ir: QueryIR; readonly row: Row };

export type JoinSource = TableName | AnyPipe;

type JoinedRow<T> = T extends string
  ? Scope<TableRow<T>, T>
  : T extends { readonly scope: infer S }
    ? S
    : never;

const nodeOf = toNode;

function refNode(name: string): Node {
  return { kind: "ref", name };
}

function projection(value: unknown): Projection {
  if (typeof value === "string") {
    const [source, alias] = splitAlias(value);
    return alias === undefined
      ? { node: refNode(source) }
      : { node: refNode(source), alias };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "alias" in value &&
    "node" in value
  ) {
    const aliased = value as { node: Node; alias: string };
    return { node: aliased.node, alias: aliased.alias };
  }
  return { node: nodeOf(value) };
}

function splitAlias(key: string): [string, string | undefined] {
  const at = key.toLowerCase().lastIndexOf(" as ");
  if (at === -1) return [key, undefined];
  return [key.slice(0, at).trim(), key.slice(at + 4).trim()];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [value];
}

export class Query<R, G = R, Grouped = false> implements PromiseLike<
  Output<R>[]
> {
  readonly ir: QueryIR;

  readonly database: string;

  declare readonly row: Output<R>;

  declare readonly scope: R;

  constructor(ir: QueryIR, database: string) {
    this.ir = ir;
    this.database = database;
  }

  private next<NR, NG = NR, NGrouped = false>(
    step: Step,
  ): Query<NR, NG, NGrouped> {
    return new Query<NR, NG, NGrouped>(
      { ctes: this.ir.ctes, steps: [...this.ir.steps, step] },
      this.database,
    );
  }

  select<const S extends SelectKey<R>>(...keys: S[]): Query<Selected<R, S>> {
    return this.next<Selected<R, S>>({
      kind: "select",
      items: keys.map((key) => projection(key)),
    });
  }

  extend<X>(build: (t: Refs<R>) => X): Query<Extended<R, X>, G, Grouped> {
    return this.next<Extended<R, X>, G, Grouped>({
      kind: "extend",
      items: list(build(scopeProxy() as Refs<R>)).map(projection),
    });
  }

  set<X extends Row>(
    build: (t: Refs<R>) => { [K in keyof X]: Expr<X[K]> },
  ): Query<Simplify<Omit<R, keyof X> & X>, G, Grouped> {
    const values = build(scopeProxy() as Refs<R>);
    return this.next<Simplify<Omit<R, keyof X> & X>, G, Grouped>({
      kind: "set",
      items: Object.entries(values).map(([alias, value]) => ({
        node: nodeOf(value),
        alias,
      })),
    });
  }

  drop<const K extends Names<R>>(
    ...names: K[]
  ): Query<Dropped<R, K>, G, Grouped> {
    return this.next<Dropped<R, K>, G, Grouped>({
      kind: "drop",
      names,
    });
  }

  rename<const M extends Partial<Record<Names<R>, string>>>(
    map: M,
  ): Query<Renamed<R, M & Record<string, string>>, G, Grouped> {
    return this.next<Renamed<R, M & Record<string, string>>, G, Grouped>({
      kind: "rename",
      pairs: Object.entries(map) as (readonly [string, string])[],
    });
  }

  as<const A extends string>(alias: A): Query<Scope<Output<R>, A>, G, Grouped> {
    return this.next<Scope<Output<R>, A>, G, Grouped>({
      kind: "as",
      alias,
    });
  }

  where(build: (t: Refs<R>) => Predicate): Query<R, G, Grouped>;
  where<const K extends Names<R>, const Op extends Operator>(
    column: K,
    operator: Op,
    value: Operand<R[K], Op> | Query<Row>,
  ): Query<R, G, Grouped>;
  where(
    first: string | ((t: Refs<R>) => Predicate),
    operator?: Operator,
    value?: unknown,
  ): Query<R, G, Grouped> {
    const predicate =
      typeof first === "string"
        ? predicateNode(first, operator as Operator, value)
        : nodeOf(first(scopeProxy() as Refs<R>));
    return this.next<R, G, Grouped>({ kind: "where", predicate });
  }

  groupBy<const K extends Names<R>>(
    ...keys: K[]
  ): Query<Selected<R, K>, R, true> {
    return this.next<Selected<R, K>, R, true>({
      kind: "groupBy",
      keys: keys.map((key) => projection(key)),
    });
  }

  aggregate<X>(
    build: ((t: Refs<G>) => X) | X,
  ): Query<Aggregated<Grouped, R, X>> {
    const items =
      typeof build === "function"
        ? list((build as (t: Refs<G>) => X)(scopeProxy() as Refs<G>))
        : list(build);
    return this.next<Aggregated<Grouped, R, X>>({
      kind: "aggregate",
      items: items.map(projection),
    });
  }

  distinct(): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "distinct" });
  }

  distinctOn<const K extends Names<R>>(...keys: K[]): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({
      kind: "distinct",
      on: keys.map((key) => refNode(key)),
    });
  }

  orderBy(
    build: (t: Refs<R>) => OrderInput | OrderInput[],
  ): Query<R, G, Grouped>;
  orderBy<const K extends Names<R>>(
    column: K,
    direction?: "asc" | "desc",
    nulls?: "first" | "last",
  ): Query<R, G, Grouped>;
  orderBy(
    first: string | ((t: Refs<R>) => OrderInput | OrderInput[]),
    direction?: "asc" | "desc",
    nulls?: "first" | "last",
  ): Query<R, G, Grouped> {
    if (typeof first === "string") {
      const term: {
        node: Node;
        direction?: "asc" | "desc";
        nulls?: "first" | "last";
      } = { node: refNode(first) };
      if (direction) term.direction = direction;
      if (nulls) term.nulls = nulls;
      return this.next<R, G, Grouped>({ kind: "orderBy", terms: [term] });
    }
    return this.next<R, G, Grouped>({
      kind: "orderBy",
      terms: orderList(first(scopeProxy() as Refs<R>)),
    });
  }

  limit(value: number): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "limit", value });
  }

  offset(value: number): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "offset", value });
  }

  private joinStep<NR>(
    join: JoinKind,
    target: unknown,
    left?: unknown,
    right?: unknown,
    lateral?: boolean,
  ): Query<NR> {
    const { source, alias } = sourceOf(target);
    const step: Step = { kind: "join", join, source };
    if (alias !== undefined) step.alias = alias;
    if (lateral) step.lateral = true;
    if (typeof left === "string" && typeof right === "string") {
      step.on = {
        kind: "binary",
        op: "=",
        left: refNode(left),
        right: refNode(right),
      };
    } else if (typeof left === "function") {
      step.on = nodeOf(
        (left as (t: Refs<Row>) => Predicate)(scopeProxy() as Refs<Row>),
      );
    }
    return this.next<NR>(step);
  }

  join<const T extends JoinSource>(
    target: T,
    left: string | ((t: Refs<Row>) => Predicate),
    right?: string,
  ): Query<Merge<R, JoinedRow<T>>> {
    return this.joinStep<Merge<R, JoinedRow<T>>>("inner", target, left, right);
  }

  leftJoin<const T extends JoinSource>(
    target: T,
    left: string | ((t: Refs<Row>) => Predicate),
    right?: string,
  ): Query<Merge<R, Nullify<JoinedRow<T>>>> {
    return this.joinStep<Merge<R, Nullify<JoinedRow<T>>>>(
      "left",
      target,
      left,
      right,
    );
  }

  rightJoin<const T extends JoinSource>(
    target: T,
    left: string | ((t: Refs<Row>) => Predicate),
    right?: string,
  ): Query<Merge<Nullify<R>, JoinedRow<T>>> {
    return this.joinStep<Merge<Nullify<R>, JoinedRow<T>>>(
      "right",
      target,
      left,
      right,
    );
  }

  fullJoin<const T extends JoinSource>(
    target: T,
    left: string | ((t: Refs<Row>) => Predicate),
    right?: string,
  ): Query<Merge<Nullify<R>, Nullify<JoinedRow<T>>>> {
    return this.joinStep<Merge<Nullify<R>, Nullify<JoinedRow<T>>>>(
      "full",
      target,
      left,
      right,
    );
  }

  crossJoin<const T extends JoinSource>(
    target: T,
  ): Query<Merge<R, JoinedRow<T>>> {
    return this.joinStep<Merge<R, JoinedRow<T>>>("cross", target);
  }

  lateral<QR>(query: Pipe<QR>): Query<Merge<R, QR>> {
    return this.joinStep<Merge<R, QR>>(
      "cross",
      query,
      undefined,
      undefined,
      true,
    );
  }

  private setOp(op: SetOp, other: AnyPipe): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "setOp", op, query: other.ir });
  }

  union(other: AnyPipe): Query<R, G, Grouped> {
    return this.setOp("union", other);
  }

  unionAll(other: AnyPipe): Query<R, G, Grouped> {
    return this.setOp("unionAll", other);
  }

  intersect(other: AnyPipe): Query<R, G, Grouped> {
    return this.setOp("intersect", other);
  }

  except(other: AnyPipe): Query<R, G, Grouped> {
    return this.setOp("except", other);
  }

  forUpdate(): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "lock", mode: "update" });
  }

  forShare(): Query<R, G, Grouped> {
    return this.next<R, G, Grouped>({ kind: "lock", mode: "share" });
  }

  private wait(mode: "skipLocked" | "noWait"): Query<R, G, Grouped> {
    const steps = [...this.ir.steps];
    const at = steps.findLastIndex((step) => step.kind === "lock");
    if (at === -1) {
      throw new Error(
        "flypath: skipLocked() and noWait() follow forUpdate() or forShare()",
      );
    }
    steps[at] = { ...(steps[at] as Step & { kind: "lock" }), wait: mode };
    return new Query<R, G, Grouped>(
      { ctes: this.ir.ctes, steps },
      this.database,
    );
  }

  skipLocked(): Query<R, G, Grouped> {
    return this.wait("skipLocked");
  }

  noWait(): Query<R, G, Grouped> {
    return this.wait("noWait");
  }

  compile(): Compiled {
    return compileQuery(this.ir);
  }

  async run(): Promise<Output<R>[]> {
    return (await execute(this.database, this.compile())) as Output<R>[];
  }

  async first(): Promise<Output<R> | undefined> {
    const rows = await this.limit(1).run();
    return rows[0];
  }

  async firstOrThrow(): Promise<Output<R>> {
    const row = await this.first();
    if (row === undefined) throw new NotFoundError();
    return row;
  }

  stream(size = 100): AsyncIterable<Output<R>> {
    return stream(this.database, this.compile(), size) as AsyncIterable<
      Output<R>
    >;
  }

  async explain(analyze = false): Promise<string> {
    const compiled = this.compile();
    const rows = await execute(this.database, {
      text: `explain ${analyze ? "(analyze, buffers) " : ""}${compiled.text}`,
      params: compiled.params,
    });
    return rows.map((row) => String(row["QUERY PLAN"])).join("\n");
  }

  then<A = Output<R>[], B = never>(
    onfulfilled?: ((value: Output<R>[]) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

function sourceOf(target: unknown): { source: Source; alias?: string } {
  if (typeof target === "string") {
    return { source: { kind: "table", name: target } };
  }
  const query = target as Query<Row>;
  const steps = query.ir.steps;
  const last = steps.at(-1);
  if (last?.kind === "as") {
    return {
      source: {
        kind: "query",
        query: { ctes: query.ir.ctes, steps: steps.slice(0, -1) },
      },
      alias: last.alias,
    };
  }
  return { source: { kind: "query", query: query.ir } };
}

type FromRow<C, N extends string> = Scope<
  N extends keyof C ? C[N] : TableRow<N>,
  N
>;

export class Db<C = Record<never, never>> {
  readonly database: string;

  private readonly ctes: readonly Cte[];

  constructor(database: string, ctes: readonly Cte[] = []) {
    this.database = database;
    this.ctes = ctes;
  }

  with<const N extends string, QR>(
    name: N,
    query: Pipe<QR>,
  ): Db<C & Record<N, QR>> {
    return new Db<C & Record<N, QR>>(this.database, [
      ...this.ctes,
      { name, query: query.ir, recursive: false },
    ]);
  }

  withRecursive<const N extends string, QR>(
    name: N,
    query: Pipe<QR>,
  ): Db<C & Record<N, QR>> {
    return new Db<C & Record<N, QR>>(this.database, [
      ...this.ctes,
      { name, query: query.ir, recursive: true },
    ]);
  }

  from<const N extends (keyof C & string) | TableName>(
    name: N,
  ): Query<FromRow<C, N & string>> {
    return new Query<FromRow<C, N & string>>(
      {
        ctes: this.ctes,
        steps: [{ kind: "from", source: { kind: "table", name } }],
      },
      this.database,
    );
  }

  sql<T = Row>(parts: TemplateStringsArray, ...values: unknown[]): Fragment<T> {
    return new Fragment<T>(
      { kind: "fragment", parts: [...parts], values: values.map(toNode) },
      this.database,
    );
  }

  into<const N extends TableName>(name: N): InsertTarget<N> {
    return new InsertTarget<N>(name, this.database);
  }

  update<const N extends TableName>(name: N): Update<N, { count: number }> {
    return new Update<N, { count: number }>(
      { kind: "update", table: name, set: [] },
      this.database,
    );
  }

  delete<const N extends TableName>(name: N): Delete<N, { count: number }> {
    return new Delete<N, { count: number }>(
      { kind: "delete", table: name },
      this.database,
    );
  }

  fromQuery<QR, const A extends string>(
    query: Pipe<QR>,
    alias: A,
  ): Query<Scope<QR, A>> {
    return new Query<Scope<QR, A>>(
      {
        ctes: this.ctes,
        steps: [
          { kind: "from", source: { kind: "query", query: query.ir }, alias },
        ],
      },
      this.database,
    );
  }
}
