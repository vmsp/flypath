import { beforeAll, describe, expect, test } from "vitest";

import { Db } from "../../src/db/query.ts";
import { registerTable } from "../../src/schema/registry.ts";
import { count, eq, ilike, max, or, rowNumber } from "../../src/sql.ts";

const db = (): Db => new Db("default");

beforeAll(() => {
  registerTable("users", ["id", "createdAt", "email", "name"]);
  registerTable("posts", ["id", "createdAt", "authorId", "body"]);
  registerTable("likes", ["postId", "userId"]);
});

describe("compileQuery", () => {
  test("folds where before select into one statement", () => {
    expect(
      db().from("users").where("id", "=", 3).select("id", "name").compile(),
    ).toMatchInlineSnapshot(`
      {
        "params": [
          3,
        ],
        "text": "select "users"."id", "users"."name" from "users" where ("users"."id" = $1)",
      }
    `);
  });

  test("folds order by and limit into the same statement", () => {
    const { text, params } = db()
      .from("posts")
      .where("body", "ilike", "%engine%")
      .select("id", "body")
      .orderBy("id", "desc")
      .limit(5)
      .compile();
    expect(text).toBe(
      'select "posts"."id", "posts"."body" from "posts" ' +
        'where ("posts"."body" ilike $1) order by "id" desc limit $2',
    );
    expect(params).toEqual(["%engine%", 5]);
  });

  test("wraps a where that follows a window extend", () => {
    const { text } = db()
      .from("posts")
      .extend((t) =>
        rowNumber()
          .over({ partitionBy: t.authorId, orderBy: [t.id, "desc"] })
          .as("rank"),
      )
      .where("rank", "<=", 3)
      .select("id", "rank")
      .compile();
    expect(text).toBe(
      'select "_1"."id", "_1"."rank" from (select "posts"."id", ' +
        '"posts"."createdAt", "posts"."authorId", "posts"."body", ' +
        'row_number() over (partition by "posts"."authorId" order by ' +
        '"posts"."id" desc) as "rank" from "posts") as "_1" ' +
        'where ("_1"."rank" <= $1)',
    );
  });

  test("turns a where after an aggregate into having", () => {
    const { text } = db()
      .from("posts")
      .groupBy("authorId")
      .aggregate((t) => [count().as("posts"), max(t.id).as("latest")])
      .where("posts", ">", 10)
      .orderBy("posts", "desc")
      .compile();
    expect(text).toBe(
      'select "posts"."authorId", count(*) as "posts", max("posts"."id") as ' +
        '"latest" from "posts" group by "posts"."authorId" ' +
        'having (count(*) > $1) order by "posts" desc',
    );
  });

  test("joins a pipe under its alias", () => {
    const { text } = db()
      .from("posts")
      .join("users", "users.id", "posts.authorId")
      .leftJoin(
        db()
          .from("likes")
          .groupBy("postId")
          .aggregate(count().as("likes"))
          .as("l"),
        "l.postId",
        "posts.id",
      )
      .select("posts.id", "users.name as author", "l.likes")
      .compile();
    expect(text).toBe(
      'select "posts"."id", "users"."name" as "author", "l"."likes" ' +
        'from "posts" join "users" on ("users"."id" = "posts"."authorId") ' +
        'left join (select "likes"."postId", count(*) as "likes" ' +
        'from "likes" group by "likes"."postId") as "l" ' +
        'on ("l"."postId" = "posts"."id")',
    );
  });

  test("puts a with clause before the select and numbers its parameters first", () => {
    const { text, params } = db()
      .with("recent", db().from("posts").orderBy("id", "desc").limit(3))
      .from("recent")
      .where("body", "ilike", "%a%")
      .select("id", "body")
      .compile();
    expect(text.startsWith('with "recent" as (select ')).toBe(true);
    expect(params).toEqual([3, "%a%"]);
  });

  test("expands in against an array as = any", () => {
    expect(
      db().from("posts").where("id", "in", [1, 2, 3]).select("id").compile(),
    ).toEqual({
      text: 'select "posts"."id" from "posts" where ("posts"."id" = any($1))',
      params: [[1, 2, 3]],
    });
  });

  test("renders a callback predicate with the columns in scope", () => {
    const { text, params } = db()
      .from("posts")
      .where((t) => or(eq(t.authorId, 3), ilike(t.body, "%engine%")))
      .select("id")
      .compile();
    expect(text).toBe(
      'select "posts"."id" from "posts" where (("posts"."authorId" = $1) ' +
        'or ("posts"."body" ilike $2))',
    );
    expect(params).toEqual([3, "%engine%"]);
  });

  test("never emits a star for a registered table", () => {
    expect(db().from("users").compile().text).not.toContain("*");
  });

  test("emits a star for a table the registry does not know", () => {
    expect(db().from("notes").compile().text).toBe(
      'select "notes".* from "notes"',
    );
  });
});

describe("compileInsert", () => {
  test("lists the columns of every row and fills the gaps with default", () => {
    expect(
      db()
        .into("users")
        .insert([{ email: "a@b.c" }, { email: "d@e.f", name: "Dee" }])
        .compile(),
    ).toEqual({
      text: 'insert into "users" ("email", "name") values ($1, default), ($2, $3)',
      params: ["a@b.c", "d@e.f", "Dee"],
    });
  });

  test("writes on conflict do nothing against a column list", () => {
    expect(
      db()
        .into("likes")
        .insert({ postId: 1, userId: 2 })
        .onConflict(["postId", "userId"])
        .doNothing()
        .compile().text,
    ).toBe(
      'insert into "likes" ("postId", "userId") values ($1, $2) ' +
        'on conflict ("postId", "userId") do nothing',
    );
  });
});

describe("compileUpdate", () => {
  test("keeps set and where independent of the order they were written", () => {
    const first = db().update("users").where("id", "=", 3).set({ name: "X" });
    const second = db().update("users").set({ name: "X" }).where("id", "=", 3);
    expect(first.compile().text).toBe(second.compile().text);
  });
});

describe("compileDelete", () => {
  test("returns the columns it was asked for", () => {
    expect(
      db().delete("posts").where("id", "=", 3).returning("id").compile().text,
    ).toBe(
      'delete from "posts" where ("posts"."id" = $1) returning "posts"."id"',
    );
  });
});
