import type { Register } from "../index.ts";
import type { Column } from "../schema/column.ts";
import type { TABLE } from "../schema/table.ts";

type SelectOf<C> = C extends Column<infer S, unknown, boolean> ? S : never;

type InsertOf<C> = C extends Column<unknown, infer I, boolean> ? I : never;

type OptionalOf<C> =
  C extends Column<unknown, unknown, infer O extends boolean> ? O : never;

type ColumnKeys<T> = Exclude<keyof T, typeof TABLE> & string;

export type Selectable<T> = { [K in ColumnKeys<T>]: SelectOf<T[K]> };

type Writable<T, K extends ColumnKeys<T>> = [InsertOf<T[K]>] extends [never]
  ? false
  : true;

type RequiredKeys<T> = {
  [K in ColumnKeys<T>]: Writable<T, K> extends true
    ? OptionalOf<T[K]> extends true
      ? never
      : K
    : never;
}[ColumnKeys<T>];

type OptionalKeys<T> = {
  [K in ColumnKeys<T>]: Writable<T, K> extends true
    ? OptionalOf<T[K]> extends true
      ? K
      : never
    : never;
}[ColumnKeys<T>];

export type Insertable<T> = {
  [K in RequiredKeys<T>]: InsertOf<T[K]>;
} & {
  [K in OptionalKeys<T>]?: InsertOf<T[K]>;
};

export type Updatable<T> = {
  [K in RequiredKeys<T> | OptionalKeys<T>]?: InsertOf<T[K]>;
};

type RegisteredSchema = Register extends { schema: infer S } ? S : never;

type NameOf<T> = T extends {
  readonly [TABLE]: { name: infer N extends string };
}
  ? N
  : T extends { flypath: "view"; name: infer N extends string }
    ? N
    : never;

type RowOf<T> = T extends { flypath: "view"; row?: infer R }
  ? NonNullable<R>
  : Selectable<T>;

type Sources<S> = {
  [K in keyof S as NameOf<S[K]>]: S[K];
};

export type Schema = Sources<RegisteredSchema>;

type Registered = [RegisteredSchema] extends [never] ? false : true;

export type TableName = Registered extends true
  ? keyof Schema & string
  : string;

export type TableRow<N extends string> = N extends keyof Schema
  ? RowOf<Schema[N]>
  : Record<string, unknown>;

export type TableOf<N extends string> = N extends keyof Schema
  ? Schema[N]
  : Record<string, never>;

export type Row = Record<string, unknown>;
