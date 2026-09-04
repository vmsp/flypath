import { sql } from "flypath";
import {
  bigint,
  enumType,
  index,
  primaryKey,
  table,
  text,
  timestamptz,
} from "flypath/schema";

export const visibility = enumType("post_visibility", ["public", "private"]);

export const users = table("users", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamptz().notNull().defaultNow(),
  handle: text().notNull().unique(),
  name: text().notNull(),
  bio: text(),
});

export const posts = table(
  "posts",
  {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    authorId: bigint()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visibility: visibility().notNull().default("public"),
    body: text().notNull(),
  },
  (t) => [
    index().on(t.authorId),
    index("posts_body_search").using(
      "gin",
      sql`to_tsvector('english', "body")`,
    ),
  ],
);

export const likes = table(
  "likes",
  {
    postId: bigint()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: bigint()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey().on(t.postId, t.userId)],
);

export const notes = table("notes", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamptz().notNull().defaultNow(),
  authorId: bigint()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text().notNull(),
});

export const signatures = table("signatures", {
  id: bigint().primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamptz().notNull().defaultNow(),
  name: text().notNull(),
});

declare module "flypath" {
  interface Register {
    schema: typeof import("./schema.ts");
  }
}
