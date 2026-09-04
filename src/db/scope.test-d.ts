import { describe, expectTypeOf, it } from "vitest";

import { bigint, index, table, text, timestamptz } from "../schema/index.ts";
import { count, eq, max } from "../sql.ts";
import { Db } from "./query.ts";
import type { Insertable, Selectable, Updatable } from "./types.ts";

export const users = table("users", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamptz().notNull().defaultNow(),
  email: text().notNull().unique(),
  name: text(),
});

export const posts = table(
  "posts",
  {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    authorId: bigint().notNull(),
    body: text().notNull(),
  },
  (t) => [index().on(t.authorId)],
);

export const likes = table("likes", {
  postId: bigint().notNull(),
  userId: bigint().notNull(),
});

export const notes = table("notes", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  body: text().notNull(),
});

declare module "../index.ts" {
  interface Register {
    schema: typeof import("./scope.test-d.ts");
  }
}

const db = (): Db => new Db("default");

describe("Selectable", () => {
  it("gives every column the type a select returns", () => {
    expectTypeOf<Selectable<typeof users>>().toEqualTypeOf<{
      id: number;
      createdAt: Date;
      email: string;
      name: string | null;
    }>();
  });
});

describe("Insertable", () => {
  it("rejects an identity column and requires a not-null column", () => {
    const row: Insertable<typeof users> = { email: "a@b.c" };
    expectTypeOf(row).toExtend<{ email: string }>();

    // @ts-expect-error id is generated always as identity
    const withId: Insertable<typeof users> = { email: "a@b.c", id: 1 };
    void withId;

    // @ts-expect-error email is not null and has no default
    const withoutEmail: Insertable<typeof users> = { name: "Ada" };
    void withoutEmail;
  });

  it("makes a column with a default optional", () => {
    const row: Insertable<typeof users> = { email: "a@b.c" };
    expectTypeOf(row.createdAt).toEqualTypeOf<Date | undefined>();
  });
});

describe("Updatable", () => {
  it("accepts every insertable column and requires none", () => {
    expectTypeOf<Updatable<typeof users>>().toEqualTypeOf<{
      createdAt?: Date;
      email?: string;
      name?: string | null;
    }>();
  });
});

describe("from", () => {
  it("types the row by the table's SQL name", async () => {
    const rows = await db().from("users").select("id", "name");
    expectTypeOf(rows).toEqualTypeOf<{ id: number; name: string | null }[]>();
  });

  it("renames a selected column to its alias", async () => {
    const rows = await db().from("users").select("email as address");
    expectTypeOf(rows).toEqualTypeOf<{ address: string }[]>();
  });

  it("refuses a table the schema does not declare", () => {
    // @ts-expect-error "nope" is not a registered table
    db().from("nope");
  });

  it("refuses a column the table does not have", () => {
    // @ts-expect-error users has no "handle"
    db().from("users").select("handle");
  });

  it("refuses a value whose type does not match the column", () => {
    // @ts-expect-error id is a number
    db().from("users").where("id", "=", "x");

    // @ts-expect-error id is a number
    db()
      .from("users")
      .where((t) => eq(t.id, "x"));
  });
});

describe("select", () => {
  it("narrows what a later step can name", () => {
    // @ts-expect-error email was dropped by the select
    db().from("users").select("id").where("email", "=", "a@b.c");
  });
});

describe("join", () => {
  it("drops a bare name that both tables carry", () => {
    // @ts-expect-error "id" is ambiguous after the join
    db().from("posts").join("users", "users.id", "posts.authorId").select("id");
  });

  it("keeps the qualified names of both tables", async () => {
    const rows = await db()
      .from("posts")
      .join("users", "users.id", "posts.authorId")
      .select("posts.id", "users.name as author");
    expectTypeOf(rows).toEqualTypeOf<{ id: number; author: string | null }[]>();
  });

  it("widens the outer side of a left join with null", async () => {
    const rows = await db()
      .from("posts")
      .leftJoin("users", "users.id", "posts.authorId")
      .select("posts.id", "users.email");
    expectTypeOf(rows).toEqualTypeOf<{ id: number; email: string | null }[]>();
  });
});

describe("extend", () => {
  it("adds the alias the callback returned", async () => {
    const rows = await db()
      .from("posts")
      .extend((t) => max(t.id).as("latest"))
      .select("id", "latest");
    expectTypeOf(rows).toEqualTypeOf<{ id: number; latest: number }[]>();
  });
});

describe("aggregate", () => {
  it("outputs the grouping keys and then the aggregates", async () => {
    const rows = await db()
      .from("posts")
      .groupBy("authorId")
      .aggregate((t) => [count().as("posts"), max(t.id).as("latest")]);
    expectTypeOf(rows).toEqualTypeOf<
      { authorId: number; posts: number; latest: number }[]
    >();
  });
});

describe("insert", () => {
  it("types returning by the columns it names", async () => {
    const rows = await db()
      .into("users")
      .insert({ email: "a@b.c" })
      .returning("id", "name");
    expectTypeOf(rows).toEqualTypeOf<{ id: number; name: string | null }[]>();
  });

  it("reports the row count when nothing is returned", async () => {
    const result = await db().into("users").insert({ email: "a@b.c" });
    expectTypeOf(result).toEqualTypeOf<{ count: number }>();
  });
});

describe("with", () => {
  it("adds the CTE to what from accepts", async () => {
    const rows = await db()
      .with("recent", db().from("posts").select("id", "body"))
      .from("recent")
      .select("id");
    expectTypeOf(rows).toEqualTypeOf<{ id: number }[]>();
  });
});

describe("first", () => {
  it("returns one row or nothing", async () => {
    const row = await db().from("notes").select("id").first();
    expectTypeOf(row).toEqualTypeOf<{ id: number } | undefined>();
  });
});
