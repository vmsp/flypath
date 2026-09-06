import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { closePools, pool } from "../../src/db/client.ts";
import { configureDatabases } from "../../src/db/config.ts";
import { Db } from "../../src/db/query.ts";
import { transaction } from "../../src/db/transaction.ts";
import { registerTable } from "../../src/schema/registry.ts";
import { count } from "../../src/sql.ts";

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
  test("runs a tagged template and types the rows by its generic", async () => {
    const rows = await db().sql<{ n: number }>`select ${41}::int + 1 as n`;
    expect(rows).toEqual([{ n: 42 }]);
  });

  test("returns the inserted row when returning names columns", async () => {
    const rows = await db()
      .into("people")
      .insert({ name: "Ada" })
      .returning("id", "name");
    expect(rows[0]?.name).toBe("Ada");
  });

  test("reports a row count when nothing is returned", async () => {
    const result = await db().into("people").insert({ name: "Grace" });
    expect(result).toEqual({ count: 1 });
  });

  test("reads back what the pipe selected", async () => {
    const rows = await db()
      .from("people")
      .where("name", "=", "Grace")
      .select("name");
    expect(rows).toEqual([{ name: "Grace" }]);
  });

  test("parses a bigint as a number", async () => {
    const rows = await db().from("people").aggregate(count().as("people"));
    expect(typeof rows[0]?.people).toBe("number");
  });

  test("refuses a bigint outside the safe integer range", async () => {
    await expect(
      db().sql`select 9223372036854775807::bigint as big`,
    ).rejects.toThrow(/does not fit in a JavaScript number/);
  });

  test("streams rows through a cursor", async () => {
    const seen: string[] = [];
    for await (const row of db().from("people").select("name").stream(1)) {
      seen.push(row.name);
    }
    expect(seen).toContain("Ada");
  });
});

describe("transaction", () => {
  test("commits what the callback wrote", async () => {
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

  test("leaves no row behind when the callback throws", async () => {
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

  test("rolls a nested transaction back to its savepoint", async () => {
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
