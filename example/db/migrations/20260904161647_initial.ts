import { sql } from "flypath";
import { createEnum, createTable, migration } from "flypath/migrations";
import {
  bigint,
  enumColumn,
  index,
  primaryKey,
  text,
  timestamptz,
} from "flypath/schema";

export default migration([
  createEnum("post_visibility", ["public", "private"]),
  createTable("users", {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    handle: text().unique().notNull(),
    name: text().notNull(),
  }),
  createTable(
    "posts",
    {
      id: bigint().primaryKey().generatedAlwaysAsIdentity(),
      createdAt: timestamptz().notNull().defaultNow(),
      authorId: bigint()
        .references({ table: "users", column: "id" }, { onDelete: "cascade" })
        .notNull(),
      visibility: enumColumn("post_visibility").notNull().default("public"),
      body: text().notNull(),
    },
    (t) => [
      index().on(t.authorId),
      index("posts_body_search").using(
        "gin",
        sql`to_tsvector('english', "body")`,
      ),
    ],
  ),
  createTable(
    "likes",
    {
      postId: bigint()
        .references({ table: "posts", column: "id" }, { onDelete: "cascade" })
        .notNull(),
      userId: bigint()
        .references({ table: "users", column: "id" }, { onDelete: "cascade" })
        .notNull(),
      createdAt: timestamptz().notNull().defaultNow(),
    },
    (t) => [primaryKey().on(t.postId, t.userId)],
  ),
  createTable("notes", {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    authorId: bigint()
      .references({ table: "users", column: "id" }, { onDelete: "cascade" })
      .notNull(),
    body: text().notNull(),
  }),
  createTable("signatures", {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    name: text().notNull(),
  }),
]);
