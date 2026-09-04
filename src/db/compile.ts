import { tableColumns } from "../schema/registry.ts";
import type {
  Compiled,
  Conflict,
  DeleteIR,
  InsertIR,
  JoinKind,
  Node,
  OrderTerm,
  Projection,
  QueryIR,
  Source,
  UpdateIR,
} from "./ir.ts";

const FROM = 0;
const JOIN = 1;
const WHERE = 2;
const GROUP = 3;
const HAVING = 4;
const PROJECT = 5;
const DISTINCT = 6;
const ORDER = 7;
const LIMIT = 8;
const LOCK = 9;

export function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }
}

type Entry =
  | { kind: "star"; source: string }
  | { kind: "item"; name: string; node: Node; base: boolean };

type Resolved = { node: Node; base: boolean };

class Level {
  readonly parent: Level | undefined;

  sources: { alias: string; columns: readonly string[] | null }[] = [];

  entries: Entry[] = [];

  from: { source: Source; alias: string } | undefined;

  joins: {
    join: JoinKind;
    source: Source;
    alias: string;
    on?: Node;
    lateral?: boolean;
  }[] = [];

  where: Node[] = [];

  groupBy: Node[] | undefined;

  having: Node[] = [];

  grouped = false;

  distinct: { on: readonly Node[] | undefined } | undefined;

  orderBy: OrderTerm[] = [];

  limit: number | undefined;

  offset: number | undefined;

  lock:
    | { mode: "update" | "share"; wait?: "skipLocked" | "noWait" }
    | undefined;

  setOps: { op: string; query: QueryIR }[] = [];

  rank = FROM;

  constructor(parent?: Level) {
    this.parent = parent;
  }

  addSource(alias: string, source: Source): void {
    const columns = sourceColumns(source);
    this.sources.push({ alias, columns });
    if (columns === null) {
      this.entries.push({ kind: "star", source: alias });
      return;
    }
    for (const name of columns) {
      this.entries.push({
        kind: "item",
        name,
        node: { kind: "column", source: alias, name },
        base: true,
      });
    }
  }

  item(name: string): Entry | undefined {
    return this.entries.find(
      (entry) => entry.kind === "item" && entry.name === name,
    );
  }

  resolve(name: string): Resolved {
    const local = this.item(name);
    if (local && local.kind === "item") {
      return { node: local.node, base: local.base };
    }

    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      const source = name.slice(0, dot);
      const column = name.slice(dot + 1);
      const known = this.sources.find((entry) => entry.alias === source);
      if (known) {
        return {
          node: { kind: "column", source, name: column },
          base: true,
        };
      }
    }

    const owner = this.sources.find((entry) => entry.columns?.includes(name));
    if (owner) {
      return {
        node: { kind: "column", source: owner.alias, name },
        base: true,
      };
    }

    const stars = this.entries.filter((entry) => entry.kind === "star");
    if (stars.length === 1 && stars[0]?.kind === "star") {
      return {
        node: { kind: "column", source: stars[0].source, name },
        base: true,
      };
    }
    if (stars.length > 1) {
      return { node: { kind: "identifier", parts: [name] }, base: true };
    }

    if (this.parent) {
      const outer = this.parent.resolve(name);
      return { node: outer.node, base: true };
    }

    throw new Error(
      `flypath: "${name}" is not a column of this query; the columns in ` +
        `scope are ${this.names().join(", ") || "(none)"}`,
    );
  }

  names(): string[] {
    return this.entries.map((entry) =>
      entry.kind === "star" ? `${entry.source}.*` : entry.name,
    );
  }
}

const cteColumns = new Map<string, readonly string[] | null>();

function sourceColumns(source: Source): readonly string[] | null {
  if (source.kind !== "table") return queryColumns(source.query);
  if (cteColumns.has(source.name)) {
    return cteColumns.get(source.name) ?? null;
  }
  return tableColumns(source.name);
}

export function queryColumns(query: QueryIR): readonly string[] | null {
  let columns: string[] | null = null;
  let grouped = false;
  for (const step of query.steps) {
    switch (step.kind) {
      case "from":
      case "join": {
        const next = sourceColumns(step.source);
        if (next === null) return null;
        columns = [...(columns ?? []), ...next];
        break;
      }
      case "select":
        columns = step.items.map((item, index) => projectionName(item, index));
        break;
      case "groupBy":
        columns = step.keys.map((item, index) => projectionName(item, index));
        grouped = true;
        break;
      case "aggregate": {
        const added = step.items.map((item, index) =>
          projectionName(item, index),
        );
        columns = grouped ? [...(columns ?? []), ...added] : added;
        grouped = true;
        break;
      }
      case "extend":
        if (columns === null) return null;
        columns = [
          ...columns,
          ...step.items.map((item, index) => projectionName(item, index)),
        ];
        break;
      case "drop":
        if (columns === null) return null;
        columns = columns.filter((name) => !step.names.includes(name));
        break;
      case "rename": {
        if (columns === null) return null;
        const pairs = new Map(step.pairs);
        columns = columns.map((name) => pairs.get(name) ?? name);
        break;
      }
      default:
        break;
    }
  }
  return columns;
}

function projectionName(item: Projection, index: number): string {
  if (item.alias !== undefined) return item.alias;
  const { node } = item;
  if (node.kind === "column") return node.name;
  if (node.kind === "ref") {
    const dot = node.name.lastIndexOf(".");
    return dot > 0 ? node.name.slice(dot + 1) : node.name;
  }
  return `column${String(index + 1)}`;
}

function containsWindow(node: Node): boolean {
  switch (node.kind) {
    case "window":
      return true;
    case "binary":
      return containsWindow(node.left) || containsWindow(node.right);
    case "prefix":
    case "postfix":
    case "group":
    case "cast":
      return containsWindow(node.operand);
    case "list":
    case "array":
      return node.items.some(containsWindow);
    case "call":
      return node.args.some(containsWindow);
    case "fragment":
      return node.values.some(containsWindow);
    case "case":
      return (
        node.branches.some(
          (branch) =>
            containsWindow(branch.when) || containsWindow(branch.then),
        ) ||
        (node.fallback !== undefined && containsWindow(node.fallback))
      );
    default:
      return false;
  }
}

type Mode = "value" | "having" | "order";

class Compiler {
  readonly params: Params;

  private scope: Level | undefined;

  constructor(params: Params) {
    this.params = params;
  }

  query(ir: QueryIR, parent?: Level): string {
    const restore: [string, readonly string[] | null | undefined][] = [];
    for (const cte of ir.ctes) {
      restore.push([cte.name, cteColumns.get(cte.name)]);
      cteColumns.set(cte.name, queryColumns(cte.query));
    }
    try {
      const prefix = ir.ctes.length > 0 ? this.ctes(ir, parent) : "";
      const levels = this.plan(ir, parent);
      return prefix + this.render(levels);
    } finally {
      for (const [name, previous] of restore) {
        if (previous === undefined) cteColumns.delete(name);
        else cteColumns.set(name, previous);
      }
    }
  }

  private ctes(ir: QueryIR, parent?: Level): string {
    const recursive = ir.ctes.some((cte) => cte.recursive);
    const parts = ir.ctes.map(
      (cte) => `${quote(cte.name)} as (${this.query(cte.query, parent)})`,
    );
    return `with ${recursive ? "recursive " : ""}${parts.join(", ")} `;
  }

  private plan(ir: QueryIR, parent?: Level): Level[] {
    const levels: Level[] = [];
    let level = new Level(parent);
    levels.push(level);

    const wrap = (): Level => {
      const next = new Level(parent);
      const alias = `_${String(levels.length)}`;
      next.from = {
        source: { kind: "query", query: { ctes: [], steps: [] } },
        alias,
      };
      next.sources = [
        {
          alias,
          columns: level.entries.every((entry) => entry.kind === "item")
            ? level.entries.map((entry) =>
                entry.kind === "item" ? entry.name : "",
              )
            : null,
        },
      ];
      next.entries = level.entries.map((entry) =>
        entry.kind === "star"
          ? { kind: "star", source: alias }
          : {
              kind: "item",
              name: entry.name,
              node: { kind: "column", source: alias, name: entry.name },
              base: true,
            },
      );
      next.rank = FROM;
      levels.push(next);
      level = next;
      return next;
    };

    for (const step of ir.steps) {
      switch (step.kind) {
        case "from": {
          const alias = step.alias ?? defaultAlias(step.source, levels.length);
          if (level.from) wrap();
          level.from = { source: step.source, alias };
          level.entries = [];
          level.sources = [];
          level.addSource(alias, step.source);
          level.rank = FROM;
          break;
        }
        case "join": {
          if (level.rank > JOIN) wrap();
          const alias = step.alias ?? defaultAlias(step.source, levels.length);
          const join: (typeof level.joins)[number] = {
            join: step.join,
            source: step.source,
            alias,
          };
          if (step.lateral) join.lateral = true;
          level.joins.push(join);
          level.addSource(alias, step.source);
          if (step.on) join.on = this.resolve(step.on, level, "value");
          level.rank = JOIN;
          break;
        }
        case "where": {
          const target = level.grouped ? HAVING : WHERE;
          const mode: Mode = level.grouped ? "having" : "value";
          if (
            level.rank > target ||
            this.blocked(step.predicate, level, mode)
          ) {
            wrap();
          }
          const predicate = this.resolve(step.predicate, level, mode);
          if (level.grouped) level.having.push(predicate);
          else level.where.push(predicate);
          level.rank = Math.max(level.rank, level.grouped ? HAVING : WHERE);
          break;
        }
        case "select": {
          if (level.rank > PROJECT) wrap();
          level.entries = step.items.map((item, index) => ({
            kind: "item" as const,
            name: projectionName(item, index),
            node: this.resolve(item.node, level, "value"),
            base: false,
          }));
          level.rank = Math.max(level.rank, PROJECT);
          break;
        }
        case "extend": {
          if (level.rank > PROJECT) wrap();
          for (const [index, item] of step.items.entries()) {
            level.entries.push({
              kind: "item",
              name: projectionName(item, index),
              node: this.resolve(item.node, level, "value"),
              base: false,
            });
          }
          level.rank = Math.max(level.rank, PROJECT);
          break;
        }
        case "set": {
          if (level.rank > PROJECT) wrap();
          for (const [index, item] of step.items.entries()) {
            const name = projectionName(item, index);
            const node = this.resolve(item.node, level, "value");
            const at = level.entries.findIndex(
              (entry) => entry.kind === "item" && entry.name === name,
            );
            const entry: Entry = { kind: "item", name, node, base: false };
            if (at === -1) level.entries.push(entry);
            else level.entries[at] = entry;
          }
          level.rank = Math.max(level.rank, PROJECT);
          break;
        }
        case "drop": {
          if (level.rank > PROJECT) wrap();
          this.expand(level);
          level.entries = level.entries.filter(
            (entry) =>
              entry.kind !== "item" || !step.names.includes(entry.name),
          );
          level.rank = Math.max(level.rank, PROJECT);
          break;
        }
        case "rename": {
          if (level.rank > PROJECT) wrap();
          this.expand(level);
          const pairs = new Map(step.pairs);
          level.entries = level.entries.map((entry) =>
            entry.kind === "item" && pairs.has(entry.name)
              ? { ...entry, name: pairs.get(entry.name) as string, base: false }
              : entry,
          );
          level.rank = Math.max(level.rank, PROJECT);
          break;
        }
        case "as": {
          if (level.rank > FROM || !level.from) {
            const next = wrap();
            next.from = {
              source: next.from?.source as Source,
              alias: step.alias,
            };
            next.sources = [
              { alias: step.alias, columns: next.sources[0]?.columns ?? null },
            ];
            next.entries = next.entries.map((entry) =>
              entry.kind === "star"
                ? { kind: "star", source: step.alias }
                : {
                    kind: "item",
                    name: entry.name,
                    node: {
                      kind: "column",
                      source: step.alias,
                      name: entry.name,
                    },
                    base: true,
                  },
            );
          } else {
            const previous = level.from.alias;
            level.from = { source: level.from.source, alias: step.alias };
            level.sources = level.sources.map((entry) =>
              entry.alias === previous
                ? { ...entry, alias: step.alias }
                : entry,
            );
            level.entries = level.entries.map((entry) =>
              entry.kind === "star"
                ? entry.source === previous
                  ? { kind: "star", source: step.alias }
                  : entry
                : entry.node.kind === "column" && entry.node.source === previous
                  ? {
                      ...entry,
                      node: {
                        kind: "column",
                        source: step.alias,
                        name: entry.node.name,
                      },
                    }
                  : entry,
            );
          }
          break;
        }
        case "groupBy": {
          if (level.rank > GROUP) wrap();
          const keys = step.keys.map((item, index) => ({
            name: projectionName(item, index),
            node: this.resolve(item.node, level, "value"),
          }));
          level.groupBy = keys.map((key) => key.node);
          level.entries = keys.map((key) => ({
            kind: "item" as const,
            name: key.name,
            node: key.node,
            base: false,
          }));
          level.grouped = true;
          level.rank = Math.max(level.rank, GROUP);
          break;
        }
        case "aggregate": {
          if (level.rank > GROUP && !level.grouped) wrap();
          if (!level.grouped) level.entries = [];
          for (const [index, item] of step.items.entries()) {
            level.entries.push({
              kind: "item",
              name: projectionName(item, index),
              node: this.resolve(item.node, level, "value"),
              base: false,
            });
          }
          level.grouped = true;
          level.rank = Math.max(level.rank, GROUP);
          break;
        }
        case "distinct": {
          if (level.rank > DISTINCT) wrap();
          level.distinct = {
            on: step.on?.map((node) => this.resolve(node, level, "value")),
          };
          level.rank = Math.max(level.rank, DISTINCT);
          break;
        }
        case "orderBy": {
          if (level.rank > ORDER) wrap();
          for (const term of step.terms) {
            level.orderBy.push({
              ...term,
              node: this.resolve(term.node, level, "order"),
            });
          }
          level.rank = Math.max(level.rank, ORDER);
          break;
        }
        case "limit": {
          if (level.rank > LIMIT) wrap();
          level.limit = step.value;
          level.rank = Math.max(level.rank, LIMIT);
          break;
        }
        case "offset": {
          if (level.rank > LIMIT) wrap();
          level.offset = step.value;
          level.rank = Math.max(level.rank, LIMIT);
          break;
        }
        case "lock": {
          const lock: NonNullable<Level["lock"]> = { mode: step.mode };
          if (step.wait !== undefined) lock.wait = step.wait;
          level.lock = lock;
          level.rank = LOCK;
          break;
        }
        case "setOp": {
          level.setOps.push({ op: step.op, query: step.query });
          level.rank = LOCK;
          break;
        }
      }
    }

    return levels;
  }

  private expand(level: Level): void {
    if (level.entries.every((entry) => entry.kind === "item")) return;
    throw new Error(
      "flypath: drop() and rename() need the table's columns, so the table " +
        "has to be declared in db/schema.ts",
    );
  }

  private blocked(node: Node, level: Level, mode: Mode): boolean {
    let blockedRef = false;
    walk(node, (child) => {
      if (child.kind !== "ref") return;
      const entry = level.item(child.name);
      if (!entry || entry.kind !== "item" || entry.base) return;
      if (mode === "order") return;
      if (mode === "having" && !containsWindow(entry.node)) return;
      blockedRef = true;
    });
    return blockedRef;
  }

  private resolve(node: Node, level: Level, mode: Mode): Node {
    return map(node, (child) => {
      if (child.kind !== "ref") return undefined;
      const entry = level.item(child.name);
      if (entry && entry.kind === "item" && !entry.base) {
        if (mode === "order")
          return { kind: "identifier", parts: [entry.name] };
        return entry.node;
      }
      return level.resolve(child.name).node;
    });
  }

  private render(levels: Level[]): string {
    let text = "";
    for (const [index, level] of levels.entries()) {
      const source =
        index === 0
          ? level.from
            ? this.source(level.from.source, level.parent)
            : undefined
          : `(${text})`;
      text = this.select(level, source);
    }
    return text;
  }

  private source(source: Source, parent?: Level): string {
    if (source.kind === "table") return quote(source.name);
    return `(${this.query(source.query, parent)})`;
  }

  private select(level: Level, source: string | undefined): string {
    const outer = this.scope;
    this.scope = level;
    try {
      return this.selectText(level, source);
    } finally {
      this.scope = outer;
    }
  }

  private selectText(level: Level, source: string | undefined): string {
    const parts: string[] = ["select"];

    if (level.distinct) {
      parts.push(
        level.distinct.on && level.distinct.on.length > 0
          ? `distinct on (${level.distinct.on
              .map((node) => this.node(node))
              .join(", ")})`
          : "distinct",
      );
    }

    parts.push(
      level.entries.length === 0
        ? "*"
        : level.entries
            .map((entry) => {
              if (entry.kind === "star") return `${quote(entry.source)}.*`;
              if (
                entry.node.kind === "column" &&
                entry.node.name === entry.name
              ) {
                return this.node(entry.node);
              }
              return `${this.node(entry.node)} as ${quote(entry.name)}`;
            })
            .join(", "),
    );

    if (source !== undefined && level.from) {
      const alias =
        level.from.source.kind === "table" &&
        level.from.source.name === level.from.alias
          ? ""
          : ` as ${quote(level.from.alias)}`;
      parts.push(`from ${source}${alias}`);
    }

    for (const join of level.joins) {
      const keyword =
        join.join === "cross"
          ? "cross join"
          : join.join === "inner"
            ? "join"
            : `${join.join} join`;
      const lateral = join.lateral ? "lateral " : "";
      const alias =
        join.source.kind === "table" && join.source.name === join.alias
          ? ""
          : ` as ${quote(join.alias)}`;
      const target = `${lateral}${this.source(join.source, level)}${alias}`;
      parts.push(
        join.on
          ? `${keyword} ${target} on ${this.node(join.on)}`
          : `${keyword} ${target}`,
      );
    }

    if (level.where.length > 0) {
      parts.push(`where ${level.where.map((n) => this.node(n)).join(" and ")}`);
    }
    if (level.groupBy) {
      parts.push(
        level.groupBy.length === 0
          ? ""
          : `group by ${level.groupBy.map((n) => this.node(n)).join(", ")}`,
      );
    }
    if (level.having.length > 0) {
      parts.push(
        `having ${level.having.map((n) => this.node(n)).join(" and ")}`,
      );
    }
    if (level.orderBy.length > 0) {
      parts.push(
        `order by ${level.orderBy.map((t) => this.term(t)).join(", ")}`,
      );
    }
    if (level.limit !== undefined) {
      parts.push(`limit ${this.params.add(level.limit)}`);
    }
    if (level.offset !== undefined) {
      parts.push(`offset ${this.params.add(level.offset)}`);
    }
    if (level.lock) {
      const wait =
        level.lock.wait === "skipLocked"
          ? " skip locked"
          : level.lock.wait === "noWait"
            ? " nowait"
            : "";
      parts.push(
        `for ${level.lock.mode === "update" ? "update" : "share"}${wait}`,
      );
    }

    let text = parts.filter((part) => part !== "").join(" ");
    for (const setOp of level.setOps) {
      const keyword =
        setOp.op === "unionAll" ? "union all" : (setOp.op as string);
      text = `${text} ${keyword} ${this.query(setOp.query, level.parent)}`;
    }
    return text;
  }

  term(term: OrderTerm): string {
    const direction = term.direction === undefined ? "" : ` ${term.direction}`;
    const nulls = term.nulls === undefined ? "" : ` nulls ${term.nulls}`;
    return `${this.node(term.node)}${direction}${nulls}`;
  }

  node(node: Node): string {
    switch (node.kind) {
      case "ref":
        return node.name
          .split(".")
          .map((part) => quote(part))
          .join(".");
      case "column":
        return `${quote(node.source)}.${quote(node.name)}`;
      case "star":
        return node.source === undefined ? "*" : `${quote(node.source)}.*`;
      case "value":
        return this.params.add(node.value);
      case "raw":
        return node.text;
      case "identifier":
        return node.parts.map((part) => quote(part)).join(".");
      case "fragment": {
        let text = node.parts[0] ?? "";
        for (const [index, value] of node.values.entries()) {
          text += this.node(value) + (node.parts[index + 1] ?? "");
        }
        return text;
      }
      case "binary":
        return `(${this.node(node.left)} ${node.op} ${this.node(node.right)})`;
      case "prefix":
        return `(${node.op} ${this.node(node.operand)})`;
      case "postfix":
        return `(${this.node(node.operand)} ${node.op})`;
      case "group":
        return `(${this.node(node.operand)})`;
      case "list":
        return `(${node.items.map((item) => this.node(item)).join(", ")})`;
      case "array":
        return `array[${node.items.map((item) => this.node(item)).join(", ")}]`;
      case "cast":
        return `(${this.node(node.operand)})::${node.type}`;
      case "call": {
        const distinct = node.distinct ? "distinct " : "";
        const args = node.args.map((arg) => this.node(arg)).join(", ");
        const order =
          node.orderBy && node.orderBy.length > 0
            ? ` order by ${node.orderBy.map((t) => this.term(t)).join(", ")}`
            : "";
        const filter = node.filter
          ? ` filter (where ${this.node(node.filter)})`
          : "";
        return `${node.name}(${distinct}${args}${order})${filter}`;
      }
      case "window": {
        const spec = node.spec;
        const clauses: string[] = [];
        if (spec.partitionBy && spec.partitionBy.length > 0) {
          clauses.push(
            `partition by ${spec.partitionBy
              .map((item) => this.node(item))
              .join(", ")}`,
          );
        }
        if (spec.orderBy && spec.orderBy.length > 0) {
          clauses.push(
            `order by ${spec.orderBy.map((t) => this.term(t)).join(", ")}`,
          );
        }
        if (spec.frame !== undefined) clauses.push(spec.frame);
        return `${this.node(node.fn)} over (${clauses.join(" ")})`;
      }
      case "case": {
        const branches = node.branches
          .map(
            (branch) =>
              `when ${this.node(branch.when)} then ${this.node(branch.then)}`,
          )
          .join(" ");
        const fallback =
          node.fallback === undefined
            ? ""
            : ` else ${this.node(node.fallback)}`;
        return `case ${branches}${fallback} end`;
      }
      case "query":
        return `(${this.query(node.query, this.scope)})`;
      case "exists":
        return `${node.negated ? "not exists" : "exists"} (${this.query(
          node.query,
          this.scope,
        )})`;
    }
  }
}

function defaultAlias(source: Source, index: number): string {
  return source.kind === "table" ? source.name : `_q${String(index)}`;
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

function children(node: Node): readonly Node[] {
  switch (node.kind) {
    case "binary":
      return [node.left, node.right];
    case "prefix":
    case "postfix":
    case "group":
    case "cast":
      return [node.operand];
    case "list":
    case "array":
      return node.items;
    case "call":
      return [
        ...node.args,
        ...(node.orderBy?.map((term) => term.node) ?? []),
        ...(node.filter ? [node.filter] : []),
      ];
    case "fragment":
      return node.values;
    case "window":
      return [
        node.fn,
        ...(node.spec.partitionBy ?? []),
        ...(node.spec.orderBy?.map((term) => term.node) ?? []),
      ];
    case "case":
      return [
        ...node.branches.flatMap((branch) => [branch.when, branch.then]),
        ...(node.fallback ? [node.fallback] : []),
      ];
    default:
      return [];
  }
}

function map(node: Node, fn: (node: Node) => Node | undefined): Node {
  const replaced = fn(node);
  if (replaced !== undefined) return replaced;
  switch (node.kind) {
    case "binary":
      return { ...node, left: map(node.left, fn), right: map(node.right, fn) };
    case "prefix":
    case "postfix":
    case "group":
    case "cast":
      return { ...node, operand: map(node.operand, fn) };
    case "list":
    case "array":
      return { ...node, items: node.items.map((item) => map(item, fn)) };
    case "call":
      return {
        ...node,
        args: node.args.map((arg) => map(arg, fn)),
        ...(node.orderBy
          ? {
              orderBy: node.orderBy.map((term) => ({
                ...term,
                node: map(term.node, fn),
              })),
            }
          : {}),
        ...(node.filter ? { filter: map(node.filter, fn) } : {}),
      };
    case "fragment":
      return { ...node, values: node.values.map((value) => map(value, fn)) };
    case "window":
      return {
        ...node,
        fn: map(node.fn, fn),
        spec: {
          ...node.spec,
          ...(node.spec.partitionBy
            ? {
                partitionBy: node.spec.partitionBy.map((item) => map(item, fn)),
              }
            : {}),
          ...(node.spec.orderBy
            ? {
                orderBy: node.spec.orderBy.map((term) => ({
                  ...term,
                  node: map(term.node, fn),
                })),
              }
            : {}),
        },
      };
    case "case":
      return {
        ...node,
        branches: node.branches.map((branch) => ({
          when: map(branch.when, fn),
          then: map(branch.then, fn),
        })),
        ...(node.fallback ? { fallback: map(node.fallback, fn) } : {}),
      };
    default:
      return node;
  }
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function literalText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : quoteString(String(value));
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return quoteString(value.toISOString());
  if (value instanceof Uint8Array) {
    return `'\\x${[...value]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}'`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "'{}'";
    return `array[${value.map((item) => literalText(item)).join(", ")}]`;
  }
  if (typeof value === "object") return quoteString(JSON.stringify(value));
  return quoteString(String(value));
}

class Literals extends Params {
  override add(value: unknown): string {
    return literalText(value);
  }
}

export function literal(node: Node): string {
  return new Compiler(new Literals()).node(node);
}

export function literalQuery(query: QueryIR): string {
  return new Compiler(new Literals()).query(query);
}

export function compileQuery(query: QueryIR): Compiled {
  const params = new Params();
  const text = new Compiler(params).query(query);
  return { text, params: params.values };
}

export function compileNode(node: Node): Compiled {
  const params = new Params();
  const text = new Compiler(params).node(node);
  return { text, params: params.values };
}

function mutationLevel(
  table: string,
  extra: readonly { source: Source; alias?: string }[] = [],
): Level {
  const level = new Level();
  level.addSource(table, { kind: "table", name: table });
  for (const entry of extra) {
    level.addSource(entry.alias ?? defaultAlias(entry.source, 0), entry.source);
  }
  return level;
}

function returningList(
  compiler: Compiler,
  level: Level,
  items: readonly Projection[],
): string {
  return items
    .map((item, index) => {
      const node = compiler.node(resolveIn(item.node, level));
      const name = projectionName(item, index);
      return item.node.kind === "column" || item.node.kind === "ref"
        ? node
        : `${node} as ${quote(name)}`;
    })
    .join(", ");
}

function resolveIn(node: Node, level: Level): Node {
  return map(node, (child) =>
    child.kind === "ref" ? level.resolve(child.name).node : undefined,
  );
}

function unqualify(node: Node): Node {
  return map(node, (child) =>
    child.kind === "column"
      ? { kind: "identifier", parts: [child.name] }
      : undefined,
  );
}

export function compileInsert(ir: InsertIR): Compiled {
  const params = new Params();
  const compiler = new Compiler(params);
  const level = mutationLevel(ir.table);
  const parts: string[] = [`insert into ${quote(ir.table)}`];

  if (ir.columns.length > 0) {
    parts.push(`(${ir.columns.map((name) => quote(name)).join(", ")})`);
  }

  if (ir.query) {
    parts.push(compiler.query(ir.query));
  } else if (ir.rows.length === 0) {
    parts.push("default values");
  } else {
    const rows = ir.rows.map(
      (row) => `(${row.map((node) => compiler.node(node)).join(", ")})`,
    );
    parts.push(`values ${rows.join(", ")}`);
  }

  if (ir.conflict) parts.push(conflictClause(compiler, level, ir.conflict));

  if (ir.returning) {
    parts.push(`returning ${returningList(compiler, level, ir.returning)}`);
  }

  return { text: parts.join(" "), params: params.values };
}

function conflictClause(
  compiler: Compiler,
  level: Level,
  conflict: Conflict,
): string {
  const parts: string[] = ["on conflict"];
  if (conflict.target?.kind === "columns") {
    parts.push(
      `(${conflict.target.columns.map((name) => quote(name)).join(", ")})`,
    );
    if (conflict.target.where) {
      parts.push(
        `where ${compiler.node(unqualify(resolveIn(conflict.target.where, level)))}`,
      );
    }
  } else if (conflict.target?.kind === "constraint") {
    parts.push(`on constraint ${quote(conflict.target.name)}`);
  }

  if (conflict.action === "nothing") {
    parts.push("do nothing");
    return parts.join(" ");
  }

  const assignments = (conflict.set ?? []).map(
    ([name, node]) =>
      `${quote(name)} = ${compiler.node(unqualify(resolveIn(node, level)))}`,
  );
  parts.push(`do update set ${assignments.join(", ")}`);
  if (conflict.where) {
    parts.push(`where ${compiler.node(resolveIn(conflict.where, level))}`);
  }
  return parts.join(" ");
}

export function compileUpdate(ir: UpdateIR): Compiled {
  const params = new Params();
  const compiler = new Compiler(params);
  const level = mutationLevel(ir.table, ir.from ?? []);
  const parts: string[] = [`update ${quote(ir.table)}`];

  const assignments = ir.set.map(
    ([name, node]) =>
      `${quote(name)} = ${compiler.node(resolveIn(node, level))}`,
  );
  parts.push(`set ${assignments.join(", ")}`);

  if (ir.from && ir.from.length > 0) {
    const sources = ir.from.map((entry) => {
      const alias = entry.alias ?? defaultAlias(entry.source, 0);
      return `${sourceText(compiler, entry.source)} as ${quote(alias)}`;
    });
    parts.push(`from ${sources.join(", ")}`);
  }

  if (ir.where) {
    parts.push(`where ${compiler.node(resolveIn(ir.where, level))}`);
  }
  if (ir.returning) {
    parts.push(`returning ${returningList(compiler, level, ir.returning)}`);
  }

  return { text: parts.join(" "), params: params.values };
}

export function compileDelete(ir: DeleteIR): Compiled {
  const params = new Params();
  const compiler = new Compiler(params);
  const level = mutationLevel(ir.table, ir.using ?? []);
  const parts: string[] = [`delete from ${quote(ir.table)}`];

  if (ir.using && ir.using.length > 0) {
    const sources = ir.using.map((entry) => {
      const alias = entry.alias ?? defaultAlias(entry.source, 0);
      return `${sourceText(compiler, entry.source)} as ${quote(alias)}`;
    });
    parts.push(`using ${sources.join(", ")}`);
  }

  if (ir.where) {
    parts.push(`where ${compiler.node(resolveIn(ir.where, level))}`);
  }
  if (ir.returning) {
    parts.push(`returning ${returningList(compiler, level, ir.returning)}`);
  }

  return { text: parts.join(" "), params: params.values };
}

function sourceText(compiler: Compiler, source: Source): string {
  return source.kind === "table"
    ? quote(source.name)
    : `(${compiler.query(source.query)})`;
}
