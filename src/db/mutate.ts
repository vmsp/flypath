import { execute, executeCount } from "./client.ts";
import { compileDelete, compileInsert, compileUpdate } from "./compile.ts";
import { Expr, predicateNode, scopeProxy, toNode } from "./expression.ts";
import type {
  Compiled,
  Conflict,
  DeleteIR,
  InsertIR,
  Node,
  Projection,
  QueryIR,
  Source,
  UpdateIR,
} from "./ir.ts";
import type {
  Names,
  Operand,
  Operator,
  Refs,
  Scope,
  Selected,
  SelectKey,
} from "./scope.ts";
import type {
  Insertable,
  Row,
  TableName,
  TableOf,
  TableRow,
  Updatable,
} from "./types.ts";

type Pipe = { ir: QueryIR };

function isPipe(value: unknown): value is Pipe {
  return (
    typeof value === "object" &&
    value !== null &&
    "ir" in value &&
    typeof (value as { ir: unknown }).ir === "object"
  );
}

const valueNode = toNode;

function projections(keys: readonly string[]): Projection[] {
  return keys.map((key) => {
    const at = key.toLowerCase().lastIndexOf(" as ");
    return at === -1
      ? { node: { kind: "ref" as const, name: key } }
      : {
          node: { kind: "ref" as const, name: key.slice(0, at).trim() },
          alias: key.slice(at + 4).trim(),
        };
  });
}

export class Insert<N extends TableName, Res> implements PromiseLike<Res> {
  readonly ir: InsertIR;

  readonly database: string;

  constructor(ir: InsertIR, database: string) {
    this.ir = ir;
    this.database = database;
  }

  onConflict(
    target?:
      | Names<TableRow<N>>
      | readonly Names<TableRow<N>>[]
      | { constraint: string }
      | { target: readonly string[]; where: Expr<unknown> },
  ): Conflicting<N, Res> {
    let conflict: Conflict = { action: "nothing" };
    if (typeof target === "string") {
      conflict = {
        action: "nothing",
        target: { kind: "columns", columns: [target] },
      };
    } else if (Array.isArray(target)) {
      conflict = {
        action: "nothing",
        target: { kind: "columns", columns: target as string[] },
      };
    } else if (target && "constraint" in target) {
      conflict = {
        action: "nothing",
        target: { kind: "constraint", name: target.constraint },
      };
    } else if (target && "target" in target) {
      conflict = {
        action: "nothing",
        target: {
          kind: "columns",
          columns: [...target.target],
          where: target.where.node,
        },
      };
    }
    return new Conflicting<N, Res>(this, conflict);
  }

  withConflict(conflict: Conflict): Insert<N, Res> {
    return new Insert<N, Res>({ ...this.ir, conflict }, this.database);
  }

  returning<const S extends SelectKey<Scope<TableRow<N>, N & string>>>(
    ...keys: S[]
  ): Insert<N, Selected<Scope<TableRow<N>, N & string>, S>[]> {
    return new Insert<N, Selected<Scope<TableRow<N>, N & string>, S>[]>(
      { ...this.ir, returning: projections(keys) },
      this.database,
    );
  }

  compile(): Compiled {
    return compileInsert(this.ir);
  }

  async run(): Promise<Res> {
    const compiled = this.compile();
    if (!this.ir.returning) {
      return { count: await executeCount(this.database, compiled) } as Res;
    }
    return (await execute(this.database, compiled)) as Res;
  }

  then<A = Res, B = never>(
    onfulfilled?: ((value: Res) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export class Conflicting<N extends TableName, Res> {
  private readonly insert: Insert<N, Res>;

  private readonly conflict: Conflict;

  constructor(insert: Insert<N, Res>, conflict: Conflict) {
    this.insert = insert;
    this.conflict = conflict;
  }

  doNothing(): Insert<N, Res> {
    return this.insert.withConflict({ ...this.conflict, action: "nothing" });
  }

  doUpdate(
    values: Updatable<TableOf<N>> | ((t: Refs<TableRow<N>>) => Row),
    where?: Expr<unknown>,
  ): Insert<N, Res> {
    const resolved =
      typeof values === "function"
        ? values(scopeProxy() as Refs<TableRow<N>>)
        : (values as Row);
    const conflict: Conflict = {
      ...this.conflict,
      action: "update",
      set: Object.entries(resolved).map(
        ([column, value]) => [column, valueNode(value)] as const,
      ),
    };
    if (where) conflict.where = where.node;
    return this.insert.withConflict(conflict);
  }
}

export class InsertTarget<N extends TableName> {
  private readonly table: N;

  private readonly database: string;

  constructor(table: N, database: string) {
    this.table = table;
    this.database = database;
  }

  insert(
    values: Insertable<TableOf<N>> | readonly Insertable<TableOf<N>>[] | Pipe,
  ): Insert<N, { count: number }> {
    if (isPipe(values)) {
      return new Insert<N, { count: number }>(
        {
          kind: "insert",
          table: this.table,
          columns: [],
          rows: [],
          query: values.ir,
        },
        this.database,
      );
    }
    const rows = (Array.isArray(values) ? values : [values]) as Row[];
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return new Insert<N, { count: number }>(
      {
        kind: "insert",
        table: this.table,
        columns,
        rows: rows.map((row) =>
          columns.map((column) =>
            column in row
              ? valueNode(row[column])
              : ({ kind: "raw", text: "default" } as Node),
          ),
        ),
      },
      this.database,
    );
  }
}

export class Update<N extends TableName, Res> implements PromiseLike<Res> {
  readonly ir: UpdateIR;

  readonly database: string;

  constructor(ir: UpdateIR, database: string) {
    this.ir = ir;
    this.database = database;
  }

  private next<R2>(patch: Partial<UpdateIR>): Update<N, R2> {
    return new Update<N, R2>({ ...this.ir, ...patch }, this.database);
  }

  set(values: Updatable<TableOf<N>> | ((t: Refs<Row>) => Row)): Update<N, Res> {
    const resolved =
      typeof values === "function"
        ? values(scopeProxy() as Refs<Row>)
        : (values as Row);
    return this.next<Res>({
      set: Object.entries(resolved).map(
        ([column, value]) => [column, valueNode(value)] as const,
      ),
    });
  }

  from(...tables: string[]): Update<N, Res> {
    return this.next<Res>({
      from: tables.map((name) => ({
        source: { kind: "table", name } as Source,
      })),
    });
  }

  where(build: (t: Refs<Row>) => Expr<unknown>): Update<N, Res>;
  where<const K extends Names<TableRow<N>>, const Op extends Operator>(
    column: K,
    operator: Op,
    value: Operand<TableRow<N>[K], Op>,
  ): Update<N, Res>;
  where(
    first: string | ((t: Refs<Row>) => Expr<unknown>),
    operator?: Operator,
    value?: unknown,
  ): Update<N, Res> {
    const predicate =
      typeof first === "string"
        ? predicateNode(first, operator as Operator, value)
        : first(scopeProxy() as Refs<Row>).node;
    return this.next<Res>({
      where: this.ir.where
        ? { kind: "binary", op: "and", left: this.ir.where, right: predicate }
        : predicate,
    });
  }

  returning<const S extends SelectKey<Scope<TableRow<N>, N & string>>>(
    ...keys: S[]
  ): Update<N, Selected<Scope<TableRow<N>, N & string>, S>[]> {
    return this.next<Selected<Scope<TableRow<N>, N & string>, S>[]>({
      returning: projections(keys),
    });
  }

  compile(): Compiled {
    return compileUpdate(this.ir);
  }

  async run(): Promise<Res> {
    const compiled = this.compile();
    if (!this.ir.returning) {
      return { count: await executeCount(this.database, compiled) } as Res;
    }
    return (await execute(this.database, compiled)) as Res;
  }

  then<A = Res, B = never>(
    onfulfilled?: ((value: Res) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export class Delete<N extends TableName, Res> implements PromiseLike<Res> {
  readonly ir: DeleteIR;

  readonly database: string;

  constructor(ir: DeleteIR, database: string) {
    this.ir = ir;
    this.database = database;
  }

  private next<R2>(patch: Partial<DeleteIR>): Delete<N, R2> {
    return new Delete<N, R2>({ ...this.ir, ...patch }, this.database);
  }

  using(...tables: string[]): Delete<N, Res> {
    return this.next<Res>({
      using: tables.map((name) => ({
        source: { kind: "table", name } as Source,
      })),
    });
  }

  where(build: (t: Refs<Row>) => Expr<unknown>): Delete<N, Res>;
  where<const K extends Names<TableRow<N>>, const Op extends Operator>(
    column: K,
    operator: Op,
    value: Operand<TableRow<N>[K], Op>,
  ): Delete<N, Res>;
  where(
    first: string | ((t: Refs<Row>) => Expr<unknown>),
    operator?: Operator,
    value?: unknown,
  ): Delete<N, Res> {
    const predicate =
      typeof first === "string"
        ? predicateNode(first, operator as Operator, value)
        : first(scopeProxy() as Refs<Row>).node;
    return this.next<Res>({
      where: this.ir.where
        ? { kind: "binary", op: "and", left: this.ir.where, right: predicate }
        : predicate,
    });
  }

  returning<const S extends SelectKey<Scope<TableRow<N>, N & string>>>(
    ...keys: S[]
  ): Delete<N, Selected<Scope<TableRow<N>, N & string>, S>[]> {
    return this.next<Selected<Scope<TableRow<N>, N & string>, S>[]>({
      returning: projections(keys),
    });
  }

  compile(): Compiled {
    return compileDelete(this.ir);
  }

  async run(): Promise<Res> {
    const compiled = this.compile();
    if (!this.ir.returning) {
      return { count: await executeCount(this.database, compiled) } as Res;
    }
    return (await execute(this.database, compiled)) as Res;
  }

  then<A = Res, B = never>(
    onfulfilled?: ((value: Res) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}
