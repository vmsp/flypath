import { describe, expect, it } from "vitest";

import {
  bigint,
  boolean,
  integer,
  jsonb,
  smallint,
  text,
  timestamptz,
  uuid,
} from "../schema/column.ts";
import { defineTable } from "../schema/table.ts";
import { compactOrder } from "./order.ts";

describe("compactOrder", () => {
  it("puts eight-byte columns before variable-width ones", () => {
    const table = defineTable("users", {
      email: text().notNull(),
      id: bigint().primaryKey().generatedAlwaysAsIdentity(),
      name: text(),
      createdAt: timestamptz().notNull().defaultNow(),
    });
    expect(compactOrder(table)).toEqual(["id", "createdAt", "email", "name"]);
  });

  it("orders fixed columns by alignment then size, descending", () => {
    const table = defineTable("wide", {
      flag: boolean().notNull(),
      key: uuid().notNull(),
      small: smallint().notNull(),
      medium: integer().notNull(),
      big: bigint().notNull(),
    });
    expect(compactOrder(table)).toEqual([
      "big",
      "medium",
      "small",
      "key",
      "flag",
    ]);
  });

  it("keeps declaration order inside a tier and among variable columns", () => {
    const table = defineTable("notes", {
      body: text().notNull(),
      meta: jsonb().notNull(),
      second: bigint().notNull(),
      first: bigint().notNull(),
    });
    expect(compactOrder(table)).toEqual(["second", "first", "body", "meta"]);
  });

  it("treats an array column as variable width", () => {
    const table = defineTable("tagged", {
      tags: text().array().notNull(),
      id: bigint().notNull(),
    });
    expect(compactOrder(table)).toEqual(["id", "tags"]);
  });
});
