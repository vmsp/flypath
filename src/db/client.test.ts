import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerTable } from "../schema/registry.ts";
import { count } from "../sql.ts";
import { closePools, pool } from "./client.ts";
import { configureDatabases } from "./config.ts";
import { Db } from "./query.ts";
import { transaction } from "./transaction.ts";

const url =
  process.env["TEST_DATABASE_URL"] ?? "postgres://localhost/flypath_test";

const name = `flypath_test_${Math.random().toString(36).slice(2, 10)}`;

const db = (): Db<Record<never, never>> => new Db(name);

beforeAll(async () => {
  configureDatabases({ [name]: { url, searchPath: name, max: 4 } });
  await pool(name).unsafe(`create schema ${name}`);
  await pool(name).unsafe(
    `create table ${name}.people (` +
      "id bigint generated always as identity primary key, " +
      "name text not null, tally bigint not null default 0)",
  );
  registerTable("people", ["id", "name", "tally"]);
});

afterAll(async () => {
  await pool(name).unsafe(`drop schema if exists ${name} cascade`);
  await closePools();
});

describe("the executor", () => {
  it("runs a tagged template and types the rows by its generic", async () => {
    const rows = await db().sql<{ n: number }>`select ${41}::int + 1 as n`;
    expect(rows).toEqual([{ n: 42 }]);
  });

  it("returns the inserted row when returning names columns", async () => {
    const rows = await db()
      .into("people")
      .insert({ name: "Ada" })
      .returning("id", "name");
    expect(rows[0]?.name).toBe("Ada");
  });

  it("reports a row count when nothing is returned", async () => {
    const result = await db().into("people").insert({ name: "Grace" });
    expect(result).toEqual({ count: 1 });
  });

  it("reads back what the pipe selected", async () => {
    const rows = await db()
      .from("people")
      .where("name", "=", "Grace")
      .select("name");
    expect(rows).toEqual([{ name: "Grace" }]);
  });

  it("parses a bigint as a number", async () => {
    const rows = await db().from("people").aggregate(count().as("people"));
    expect(typeof rows[0]?.people).toBe("number");
  });

  it("refuses a bigint outside the safe integer range", async () => {
    await expect(
      db().sql`select 9223372036854775807::bigint as big`,
    ).rejects.toThrow(/does not fit in a JavaScript number/);
  });

  it("streams rows through a cursor", async () => {
    const seen: string[] = [];
    for await (const row of db().from("people").select("name").stream(1)) {
      seen.push(row.name);
    }
    expect(seen).toContain("Ada");
  });
});

describe("transaction", () => {
  it("commits what the callback wrote", async () => {
    await transaction(
      async () => {
        await db().into("people").insert({ name: "Barbara" });
      },
      { name },
    );
    const rows = await db()
      .from("people")
      .where("name", "=", "Barbara")
      .select("id");
    expect(rows).toHaveLength(1);
  });

  it("leaves no row behind when the callback throws", async () => {
    await expect(
      transaction(
        async () => {
          await db().into("people").insert({ name: "Rejected" });
          throw new Error("no");
        },
        { name },
      ),
    ).rejects.toThrow("no");

    const rows = await db()
      .from("people")
      .where("name", "=", "Rejected")
      .select("id");
    expect(rows).toEqual([]);
  });

  it("rolls a nested transaction back to its savepoint", async () => {
    await transaction(
      async () => {
        await db().into("people").insert({ name: "Outer" });
        await transaction(
          async () => {
            await db().into("people").insert({ name: "Inner" });
            throw new Error("inner");
          },
          { name },
        ).catch(() => undefined);
      },
      { name },
    );

    const outer = await db()
      .from("people")
      .where("name", "=", "Outer")
      .select("id");
    const inner = await db()
      .from("people")
      .where("name", "=", "Inner")
      .select("id");
    expect(outer).toHaveLength(1);
    expect(inner).toEqual([]);
  });
});
