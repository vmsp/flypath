import type { Aliased, Expr } from "./expression.ts";

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type Qualified<T, N extends string> = {
  [K in keyof T & string as `${N}.${K}`]: T[K];
};

export type Scope<T, N extends string> = T & Qualified<T, N>;

type Bare<R> = {
  [K in keyof R as K extends `${string}.${string}` ? never : K]: R[K];
};

type OnlyQualified<R> = {
  [K in keyof R as K extends `${string}.${string}` ? K : never]: R[K];
};

export type Merge<A, B> = OnlyQualified<A> &
  OnlyQualified<B> &
  Omit<Bare<A>, keyof Bare<B>> &
  Omit<Bare<B>, keyof Bare<A>>;

export type Nullify<T> = { [K in keyof T]: T[K] | null };

export type Output<R> = Simplify<Bare<R>>;

export type Names<R> = keyof R & string;

type BareName<K extends string> = K extends `${string}.${infer C}` ? C : K;

export type SelectKey<R> = Names<R> | `${Names<R>} as ${string}`;

type AliasOf<S extends string> = S extends `${string} as ${infer A}`
  ? A
  : BareName<S>;

type SourceOf<S extends string> = S extends `${infer C} as ${string}` ? C : S;

export type Selected<R, S extends string> = Simplify<{
  [K in S as AliasOf<K>]: SourceOf<K> extends keyof R ? R[SourceOf<K>] : never;
}>;

export type Refs<R> = { [K in keyof R]-?: Expr<R[K]> };

type AliasedOf<X> =
  X extends Aliased<infer T, infer A>
    ? { [K in A]: T }
    : X extends readonly unknown[]
      ? UnionToIntersection<AliasedOf<X[number]>>
      : never;

export type Extended<R, X> = Simplify<R & AliasedOf<X>>;

export type Aggregated<Grouped, R, X> = Grouped extends true
  ? Simplify<R & AliasedOf<X>>
  : Simplify<AliasedOf<X>>;

export type Dropped<R, K extends string> = Simplify<
  Omit<R, K | `${string}.${K}`>
>;

export type Renamed<R, M extends Record<string, string>> = Simplify<{
  [K in keyof R as K extends keyof M ? M[K] & string : K]: R[K];
}>;

export type Operator =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not in"
  | "is"
  | "is not"
  | "is distinct from"
  | "like"
  | "ilike"
  | "not like"
  | "not ilike"
  | "~"
  | "~*"
  | "@>"
  | "<@"
  | "&&"
  | "?"
  | "?|"
  | "?&"
  | "between";

export type Operand<T, Op extends Operator> = Op extends "in" | "not in"
  ? readonly T[] | Expr<readonly T[]>
  : Op extends "is" | "is not"
    ? null | boolean
    : Op extends "like" | "ilike" | "not like" | "not ilike" | "~" | "~*"
      ? string | Expr<string>
      : Op extends "between"
        ? readonly [T, T]
        : Op extends "?" | "?|" | "?&"
          ? string | readonly string[]
          : T | Expr<T>;
