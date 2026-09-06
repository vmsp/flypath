import { describe, expect, test } from "vitest";

import { conservative, diff } from "../../src/migrations/diff.ts";
import type { Operation } from "../../src/migrations/operations.ts";
import {
  addColumn,
  createEnum,
  createTable,
  dropColumn,
} from "../../src/migrations/operations.ts";
import {
  apply,
  invert,
  IrreversibleError,
  schemaState,
} from "../../src/migrations/state.ts";
import { bigint, text } from "../../src/schema/column.ts";
import { emptyState } from "../../src/schema/types.ts";

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
  test("adds a column to the table an earlier operation created", () => {
    const state = fold([users, addColumn("users", "bio", text())]);
    expect(state.tables["users"]?.order).toEqual(["id", "name", "bio"]);
  });

  test("refuses an operation against a table no migration creates", () => {
    expect(() => fold([addColumn("nope", "bio", text())])).toThrow(
      /no earlier migration creates/,
    );
  });

  test("folds a whole sequence of operations into one state", () => {
    const state = fold([
      createEnum("kind", ["a"]),
      users,
      addColumn("users", "bio", text()),
    ]);
    expect(Object.keys(state.tables)).toEqual(["users"]);
    expect(state.tables["users"]?.order).toEqual(["id", "name", "bio"]);
    expect(state.enums["kind"]?.values).toEqual(["a"]);
  });
});

describe("invert", () => {
  test("reverses a created table into a dropped one", () => {
    expect(invert(users, emptyState())).toEqual([
      { kind: "dropTable", name: "users" },
    ]);
  });

  test("rebuilds a dropped column from the state before it", () => {
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

  test("refuses a sql operation with no down", () => {
    expect(() => invert({ kind: "sql", up: "select 1" }, emptyState())).toThrow(
      IrreversibleError,
    );
  });
});

describe("diff", () => {
  test("is empty when the history already matches the schema", async () => {
    const state = fold([users]);
    expect(await diff(state, structuredClone(state))).toEqual([]);
  });

  test("emits one addColumn for a column the schema gained", async () => {
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

  test("proposes a renameColumn when the prompt says yes", async () => {
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

  test("drops and adds instead of renaming when nothing answers the prompt", async () => {
    const before = fold([users, addColumn("users", "bio", text())]);
    const after = fold([users, addColumn("users", "about", text())]);
    const kinds = (await diff(before, after, conservative)).map(
      (operation) => operation.kind,
    );
    expect(kinds).toEqual(["addColumn", "dropColumn"]);
  });

  test("refuses a not-null column with no default and no answer", async () => {
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

  test("orders created tables so a reference lands after its target", async () => {
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
  test("keys tables by their SQL name, not their export name", async () => {
    const module = await import("../../src/schema/index.ts");
    const built = schemaState({
      people: module.table("users", { id: module.bigint().primaryKey() }),
    });
    expect(Object.keys(built.tables)).toEqual(["users"]);
  });
});
