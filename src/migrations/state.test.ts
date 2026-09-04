import { describe, expect, it } from "vitest";

import { bigint, text } from "../schema/column.ts";
import { emptyState } from "../schema/types.ts";
import { conservative, diff } from "./diff.ts";
import type { Operation } from "./operations.ts";
import {
  addColumn,
  createEnum,
  createTable,
  dropColumn,
  migration,
} from "./operations.ts";
import {
  apply,
  invert,
  IrreversibleError,
  replay,
  schemaState,
} from "./state.ts";

const users = createTable("users", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
});

function fold(operations: readonly Operation[]) {
  let state = emptyState();
  for (const operation of operations) state = apply(state, operation);
  return state;
}

describe("apply", () => {
  it("adds a column to the table an earlier operation created", () => {
    const state = fold([users, addColumn("users", "bio", text())]);
    expect(state.tables["users"]?.order).toEqual(["id", "name", "bio"]);
  });

  it("refuses an operation against a table no migration creates", () => {
    expect(() => fold([addColumn("nope", "bio", text())])).toThrow(
      /no earlier migration creates/,
    );
  });
});

describe("replay", () => {
  it("folds every file in order into one state", () => {
    const state = replay([
      migration([createEnum("kind", ["a"]), users]),
      migration([addColumn("users", "bio", text())]),
    ]);
    expect(Object.keys(state.tables)).toEqual(["users"]);
    expect(state.enums["kind"]?.values).toEqual(["a"]);
  });
});

describe("invert", () => {
  it("reverses a created table into a dropped one", () => {
    expect(invert(users, emptyState())).toEqual([
      { kind: "dropTable", name: "users" },
    ]);
  });

  it("rebuilds a dropped column from the state before it", () => {
    const before = fold([users]);
    expect(invert(dropColumn("users", "name"), before)).toEqual([
      {
        kind: "addColumn",
        table: "users",
        name: "name",
        column: before.tables["users"]?.columns["name"],
      },
    ]);
  });

  it("refuses a sql operation with no down", () => {
    expect(() => invert({ kind: "sql", up: "select 1" }, emptyState())).toThrow(
      IrreversibleError,
    );
  });
});

describe("diff", () => {
  it("is empty when the history already matches the schema", async () => {
    const state = fold([users]);
    expect(await diff(state, structuredClone(state))).toEqual([]);
  });

  it("emits one addColumn for a column the schema gained", async () => {
    const before = fold([users]);
    const after = fold([users, addColumn("users", "bio", text())]);
    const operations = await diff(before, after);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: "addColumn",
      table: "users",
      name: "bio",
    });
  });

  it("proposes a renameColumn when the prompt says yes", async () => {
    const before = fold([users]);
    const after = fold([
      createTable("users", {
        id: bigint().primaryKey().generatedAlwaysAsIdentity(),
        displayName: text().notNull(),
      }),
    ]);
    const operations = await diff(before, after, {
      confirm: async () => true,
      value: async () => undefined,
    });
    expect(operations).toEqual([
      { kind: "renameColumn", table: "users", from: "name", to: "displayName" },
    ]);
  });

  it("drops and adds instead of renaming when nothing answers the prompt", async () => {
    const before = fold([users, addColumn("users", "bio", text())]);
    const after = fold([users, addColumn("users", "about", text())]);
    const kinds = (await diff(before, after, conservative)).map(
      (operation) => operation.kind,
    );
    expect(kinds).toEqual(["addColumn", "dropColumn"]);
  });

  it("refuses a not-null column with no default and no answer", async () => {
    const before = fold([users]);
    const after = fold([
      createTable("users", {
        id: bigint().primaryKey().generatedAlwaysAsIdentity(),
        name: text().notNull(),
        handle: text().notNull(),
      }),
    ]);
    await expect(diff(before, after, conservative)).rejects.toThrow(
      /has no default/,
    );
  });

  it("orders created tables so a reference lands after its target", async () => {
    const target = fold([
      createTable("posts", {
        id: bigint().primaryKey().generatedAlwaysAsIdentity(),
        authorId: bigint()
          .notNull()
          .references({ table: "users", column: "id" }),
      }),
      users,
    ]);
    const names = (await diff(emptyState(), target))
      .filter((operation) => operation.kind === "createTable")
      .map((operation) => operation.table.name);
    expect(names).toEqual(["users", "posts"]);
  });
});

describe("schemaState", () => {
  it("keys tables by their SQL name, not their export name", async () => {
    const module = await import("../schema/index.ts");
    const built = schemaState({
      people: module.table("users", { id: module.bigint().primaryKey() }),
    });
    expect(Object.keys(built.tables)).toEqual(["users"]);
  });
});
