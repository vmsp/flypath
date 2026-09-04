import { execute, executeCount, stream } from "./client.ts";
import { compileNode } from "./compile.ts";
import { Expr, toNode as sharedNode } from "./expression.ts";
import type { Compiled, Node } from "./ir.ts";

export class NotFoundError extends Error {
  constructor(message = "flypath: the query returned no rows") {
    super(message);
    this.name = "NotFoundError";
  }
}

function toNode(value: unknown): Node {
  return sharedNode(value);
}

export class Fragment<T> extends Expr<T> implements PromiseLike<T[]> {
  readonly database: string;

  constructor(node: Node, database = "default") {
    super(node);
    this.database = database;
  }

  compile(): Compiled {
    return compileNode(this.node);
  }

  async run(): Promise<T[]> {
    return (await execute(this.database, this.compile())) as T[];
  }

  async count(): Promise<number> {
    return executeCount(this.database, this.compile());
  }

  async first(): Promise<T | undefined> {
    const rows = await this.run();
    return rows[0];
  }

  async firstOrThrow(): Promise<T> {
    const row = await this.first();
    if (row === undefined) throw new NotFoundError();
    return row;
  }

  stream(size = 100): AsyncIterable<T> {
    return stream(this.database, this.compile(), size) as AsyncIterable<T>;
  }

  then<A = T[], B = never>(
    onfulfilled?: ((value: T[]) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

function tag<T = Record<string, unknown>>(
  parts: TemplateStringsArray,
  ...values: unknown[]
): Fragment<T> {
  return new Fragment<T>({
    kind: "fragment",
    parts: [...parts],
    values: values.map(toNode),
  });
}

export type SqlTag = {
  <T = Record<string, unknown>>(
    parts: TemplateStringsArray,
    ...values: unknown[]
  ): Fragment<T>;
  ref: (name: string) => Expr<unknown>;
  raw: (text: string) => Expr<unknown>;
  join: (items: readonly unknown[], separator?: string) => Expr<unknown>;
};

export const sql: SqlTag = Object.assign(tag, {
  ref: (name: string): Expr<unknown> =>
    new Expr<unknown>({ kind: "identifier", parts: name.split(".") }),
  raw: (text: string): Expr<unknown> =>
    new Expr<unknown>({ kind: "raw", text }),
  join: (items: readonly unknown[], separator = ", "): Expr<unknown> => {
    const parts = items.map((_, index) => (index === 0 ? "" : separator));
    return new Expr<unknown>({
      kind: "fragment",
      parts: [...parts, ""],
      values: items.map(toNode),
    });
  },
});
