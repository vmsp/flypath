export type Node =
  | { kind: "ref"; name: string }
  | { kind: "column"; source: string; name: string }
  | { kind: "star"; source?: string }
  | { kind: "value"; value: unknown }
  | { kind: "raw"; text: string }
  | { kind: "identifier"; parts: readonly string[] }
  | { kind: "fragment"; parts: readonly string[]; values: readonly Node[] }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "prefix"; op: string; operand: Node }
  | { kind: "postfix"; op: string; operand: Node }
  | { kind: "group"; operand: Node }
  | { kind: "list"; items: readonly Node[] }
  | { kind: "array"; items: readonly Node[] }
  | { kind: "cast"; operand: Node; type: string }
  | {
      kind: "call";
      name: string;
      args: readonly Node[];
      distinct?: boolean;
      orderBy?: readonly OrderTerm[];
      filter?: Node;
    }
  | { kind: "window"; fn: Node; spec: WindowSpec }
  | { kind: "case"; branches: readonly CaseBranch[]; fallback?: Node }
  | { kind: "query"; query: QueryIR }
  | { kind: "exists"; query: QueryIR; negated: boolean };

type CaseBranch = { when: Node; then: Node };

export type WindowSpec = {
  partitionBy?: readonly Node[];
  orderBy?: readonly OrderTerm[];
  frame?: string;
};

export type OrderTerm = {
  node: Node;
  direction?: "asc" | "desc";
  nulls?: "first" | "last";
};

export type Projection = { node: Node; alias?: string };

export type Source =
  | { kind: "table"; name: string }
  | { kind: "query"; query: QueryIR };

export type JoinKind = "inner" | "left" | "right" | "full" | "cross";

export type SetOp = "union" | "unionAll" | "intersect" | "except";

export type Step =
  | { kind: "from"; source: Source; alias?: string }
  | {
      kind: "join";
      join: JoinKind;
      source: Source;
      alias?: string;
      on?: Node;
      lateral?: boolean;
    }
  | { kind: "where"; predicate: Node }
  | { kind: "select"; items: readonly Projection[] }
  | { kind: "extend"; items: readonly Projection[] }
  | { kind: "set"; items: readonly Projection[] }
  | { kind: "drop"; names: readonly string[] }
  | { kind: "rename"; pairs: readonly (readonly [string, string])[] }
  | { kind: "as"; alias: string }
  | { kind: "groupBy"; keys: readonly Projection[] }
  | { kind: "aggregate"; items: readonly Projection[] }
  | { kind: "distinct"; on?: readonly Node[] }
  | { kind: "orderBy"; terms: readonly OrderTerm[] }
  | { kind: "limit"; value: number }
  | { kind: "offset"; value: number }
  | { kind: "setOp"; op: SetOp; query: QueryIR }
  | {
      kind: "lock";
      mode: "update" | "share";
      wait?: "skipLocked" | "noWait";
    };

export type Cte = { name: string; query: QueryIR; recursive: boolean };

export type QueryIR = { ctes: readonly Cte[]; steps: readonly Step[] };

type ConflictTarget =
  | { kind: "columns"; columns: readonly string[]; where?: Node }
  | { kind: "constraint"; name: string };

export type Conflict = {
  target?: ConflictTarget;
  action: "nothing" | "update";
  set?: readonly (readonly [string, Node])[];
  where?: Node;
};

export type InsertIR = {
  kind: "insert";
  table: string;
  columns: readonly string[];
  rows: readonly (readonly Node[])[];
  query?: QueryIR;
  conflict?: Conflict;
  returning?: readonly Projection[];
};

export type UpdateIR = {
  kind: "update";
  table: string;
  set: readonly (readonly [string, Node])[];
  from?: readonly { source: Source; alias?: string }[];
  where?: Node;
  returning?: readonly Projection[];
};

export type DeleteIR = {
  kind: "delete";
  table: string;
  using?: readonly { source: Source; alias?: string }[];
  where?: Node;
  returning?: readonly Projection[];
};

export type Compiled = { text: string; params: readonly unknown[] };
