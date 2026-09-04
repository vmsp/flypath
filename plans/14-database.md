# Flypath — database

## Goal

Give a flypath app a database. Three pieces, one dialect: a schema file that
declares tables once and types every query; a query builder that reads like
a pipeline and cannot reference a column that is not in scope; and a
migration system that diffs the schema file against migration history the
way Django does, applies and reverses migrations from the CLI, and writes
`CREATE TABLE` statements in the compact column order.

Postgres only. Not "Postgres first": there is no dialect layer, no
lowest-common-denominator type set, and every Postgres feature an app is
likely to reach for — identity columns, `RETURNING`, `ON CONFLICT`, CTEs,
window functions, arrays, `jsonb`, enums, ranges, partial and expression
indexes, `FOR UPDATE SKIP LOCKED`, `DISTINCT ON`, `LATERAL` — is a
first-class citizen of the builder, the schema and the migrations.

```ts
import { db, sql } from "flypath";

await db().into("users").insert({ email, name });

await db().update("users").where("id", "=", 3).set({ name });

await db().from("users").where("id", "=", 3).select("id", "name");

await sql`select col1, col2 from table1`;
```

Milestone: `example/app/posts.ts` and `example/app/actions.ts` lose their
module-level arrays. `example/db/schema.ts` declares `users`, `posts`,
`likes`, `notes` and `signatures`; `flypath makemigration` writes
`example/db/migrations/20260904150000_initial.ts` from it with columns in compact
order; `flypath migrate` creates the tables in a local Postgres; the feed,
post, compose, guestbook and like flows read and write through `db()` on
web, iOS and Android; `flypath rollback` drops it all again; and a column
added to `schema.ts` produces a second migration that `flypath migrate`
applies without touching the first.

## What is missing today

**There is no persistence.** `example/app/posts.ts` is an array, `actions.ts`
holds `signatures` and `notes` in module scope, and a restart empties all
three. Every route in the example that mutates is a demo of the framework
and a lie about the app. `TODO` lists "DB, Migrations" directly under
release builds.

**There is no server-only data path.** `flypath`'s root export is split by
the `react-server` condition (`package.json` `exports["."]`) into
`index.server.ts` and `index.ts`, which is exactly the seam a database
client needs — the server build gets the real thing and the client build
gets a stub — but nothing uses it for I/O yet. `navigate` and `revalidate`
are the only split exports and both are pure.

**There is a request store and nothing in it needs a connection.**
`runWithRequest` (`runtime/platform-store.ts:17`) wraps every render and
action in an `AsyncLocalStorage`, and `context()` (`router/context.ts`)
reads from it ambiently. A transaction is the canonical thing that wants
to be ambient in a request and there is nowhere to hang one.

**The CLI has no data commands.** `cli.ts` knows `dev`, `build`, `ios`,
`android`. There is no command that loads project TypeScript outside Vite's
server, which `makemigration` and `migrate` both need.

**No environment is loaded.** Nothing in `src/` reads a `.env`; the only
`process.env` reads are `NODE_ENV`, `ANDROID_HOME`, `JAVA_HOME`. A
connection string has to come from somewhere.

## Field notes — prior art

- **Kysely** is the API to beat and the closest ancestor of what is asked
  for. A `Database` interface maps table name to a row interface;
  `Generated<T>` and `ColumnType<Select, Insert, Update>` give each column
  three types; `selectFrom("person").where("id", "=", 1).select(["id", "name"])`
  is the chain; `"person.id"` and `"first_name as name"` are parsed as
  template literal types so the result row is exactly the selected columns
  with their aliases; `leftJoin` makes the joined table's columns nullable;
  `sql` is a tagged template whose interpolations become parameters and
  which can be embedded anywhere an expression goes; `.compile()` returns
  `{ sql, parameters }`. Its costs are instructive: the `Database`
  interface is written by hand or generated from a live database
  (`kysely-codegen`), so the schema is not the source of truth; `select`
  after `where` is allowed but only because Kysely's builder is
  order-insensitive, so typing is by the union of everything mentioned
  rather than by the pipeline position; there is no migration generator,
  only a runner (`Migrator`) over hand-written `up`/`down` files; and its
  type instantiation depth is a known editor-latency problem on wide
  schemas.
- **Drizzle** is the schema-first half. `pgTable("users", { id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), ... }, (t) => [index().on(t.name)])`
  is nearly the syntax in the brief, and its column vocabulary is a
  faithful census of Postgres types (`bigint` with a `mode`, `numeric` as
  string, `timestamp` with `withTimezone` and `mode: "date" | "string"`,
  `jsonb().$type<T>()`, `.array()`, `pgEnum`, `customType`). Its migration
  workflow — `drizzle-kit generate` diffs the TS schema against
  `meta/NNNN_snapshot.json`, writes `NNNN_name.sql`, prompts on possible
  renames; `migrate` applies; `push` skips files — is the modern default.
  Its weaknesses: the snapshot is a large generated JSON that conflicts on
  every branch merge and has to be regenerated by hand; migrations are
  plain SQL with **no rollback** (drizzle-kit has no `down`); and its query
  API is SQL-shaped (`select().from().where()`), which makes the
  order-of-clauses question the user's problem.
- **Dapper** is the reminder that the raw path is not a fallback. A
  micro-ORM whose entire API is "execute this SQL, map the rows onto this
  type" with multi-mapping for joins, and it is the most used data layer in
  .NET because a typed `sql` string with parameters is most of what an app
  needs. The `sql` tag in this plan is designed as a peer of the builder,
  not an escape hatch: typed rows via a generic, composable fragments,
  parameters by interpolation, and the builder's own expressions embeddable
  in it.
- **Django** is the migration system to copy. `makemigrations` compares the
  models against the state produced by **replaying every migration's
  operations in memory** — there is no snapshot file; the migration history
  is the snapshot. Operations are data (`CreateModel`, `AddField`,
  `AlterField`, `RunSQL`, `RunPython`), each knows its inverse given the
  state before it, so `migrate app 0002` reverses `0003` without a
  hand-written `down`. Files are `NNNN_name.py`, sequential, with an
  explicit `dependencies` list; the `django_migrations` table records
  `(app, name, applied)`; `--check` fails CI on a missing migration;
  `sqlmigrate` prints the SQL; Postgres migrations run in one transaction
  each. It prompts on ambiguous renames and on adding a `NOT NULL` column
  without a default. Its known pains: `RunPython` needs "historical models"
  (a frozen ORM per migration), which is a large machine flypath does not
  need if data migrations use `sql`; and the dependency graph exists
  because Django has many apps, which flypath does not.
- **Rails** is the other reference point. Timestamped files
  (`20240502100843_create_products.rb`), a `change` method Active Record
  reverses automatically where it can and `up`/`down` where it cannot, a
  `schema_migrations` table with one `version` column, `db:rollback STEP=n`,
  `db:migrate:status`, and each migration in a DDL transaction with
  `disable_ddl_transaction!` for `CREATE INDEX CONCURRENTLY`. The lesson
  Rails teaches by negative example is the schema file: `schema.rb` is
  **dumped from the live database** after every migrate, so the repository
  carries a generated file that is the truth only if everyone's local
  database is, and `structure.sql` exists because the Ruby DSL cannot
  round-trip Postgres. The brief asks for the opposite direction — the
  schema file is authored and the migrations are derived — which is
  Django's direction, and this plan follows it.
- **Prisma** diffs against a shadow database it creates and replays into.
  Correct by construction and slow, needs `CREATEDB` privileges, and
  produces SQL migrations with no rollback. Not followed.
- **GoogleSQL pipe syntax** is the shape of the query API. A query starts
  with `FROM`, and every subsequent operator takes the previous table and
  produces a new one: `SELECT` projects, `EXTEND` adds computed columns,
  `SET` replaces, `DROP` removes, `RENAME` renames, `AS` aliases the
  table, `WHERE` filters (and replaces `HAVING` and `QUALIFY` because it
  can follow `AGGREGATE` or a window `EXTEND`), `AGGREGATE ... GROUP BY`
  outputs the grouping columns then the aggregates, `ORDER BY`, `LIMIT`,
  `DISTINCT`, `JOIN`, `UNION`/`INTERSECT`/`EXCEPT`, `WITH`. The rule that
  makes it type-safe for free: "a pipe operator can see every alias that
  exists in the table preceding the pipe" and nothing else. That is also
  the reason it compiles cleanly — ZetaSQL lowers each operator to a scan
  over the previous one and lets the planner flatten — and the same
  lowering, with a folding step, is what flypath's compiler does.
- **GitLab's column ordering rule** is short: Postgres pads columns to
  their alignment, so order fixed-width columns by descending size and put
  variable-width columns (`text`, `varchar`, `jsonb`, arrays, `numeric`)
  last. Their example saves 8 bytes a row on `events`. It only applies at
  `CREATE TABLE` — `ADD COLUMN` always appends — so it is a rule for the
  migration generator, not for the developer's `schema.ts`.

The consensus: schema in code as the source of truth (Drizzle, Prisma),
migrations derived by diffing against replayed history rather than a
snapshot or a live database (Django), files that are data so they reverse
themselves (Django, Rails `change`), a tagged `sql` template that is a
real API (Kysely, postgres.js, Dapper), and typing by narrowing the row
through the chain (Kysely). Nobody has a pipeline-ordered builder where the
type of each step is the table the previous step produced; pipe syntax
describes one and it fits flypath's "one obvious order" taste.

## Options considered

### The driver

- **Own wire-protocol client.** Total control, no dependency. The Postgres
  extended protocol, SASL/SCRAM auth, TLS, type OIDs and text/binary
  formats, pipelining, `COPY`, cursors, and `LISTEN` are three to five
  thousand lines that already exist, and none of it is where flypath adds
  value. Rejected.
- **`pg`.** The incumbent, widest tested, slowest of the three, arrays and
  bigint parsing bolted on, no pipelining, pool and cursor as separate
  packages. Would work.
- **`postgres` (postgres.js).** Pure JS, one package, fastest by its own
  and Kysely's benchmarks, implicit pipelining, prepared statements by
  default, `sql.unsafe(text, params)` for compiled queries, `sql.begin()`
  with savepoints, `.cursor()`, `LISTEN`, `COPY`, a `types` map for
  parsers, and its own tagged template — which flypath does not use, but
  which proves the parameterization model. Chosen. It is a direct
  dependency, not a peer: it has no native code, it is smaller than
  `oxc-parser`, and `flypath` already ships `vite` and `ws` the same way.

### Migration file format

- **SQL files** (Drizzle, `structure.sql`). Reviewable in any tool, no
  DSL to maintain. But the generator then needs a snapshot to diff against
  (SQL is not replayable into a state without a parser), rollback needs a
  hand-written down half, and a `-- down` marker convention is a worse DSL
  than a DSL.
- **Imperative TS with `up`/`down`** (Kysely `Migrator`, Knex). Reversible
  when the author remembers, unreplayable because the calls are opaque.
- **Declarative TS operations** (Django). Each file is a list of operation
  values; the state replayer folds them into a schema; each operation
  knows its inverse from that state; `sql` and `run` operations carry an
  optional `down` and are irreversible without it. The generator diffs the
  replayed state against `schema.ts`, so there is no snapshot file to
  conflict on. Chosen. The cost is that the operation vocabulary must be
  complete enough to describe every table `schema.ts` can — which is the
  same vocabulary, so it is written once.

### Where things live

`db/schema.ts` and `db/migrations/YYYYMMDDHHMMSS_name.ts`. The brief allows
`/migrations` if nothing else needs a `db/`; the schema does, and putting
the two side by side is what Rails, Drizzle and Prisma all converge on. The
routes file stays in `app/` because it is the app tree; the schema is not.

## Shape

```
db/
  schema.ts
  migrations/
    20260904150000_initial.ts
    20260905093012_add_users_bio.ts
```

```ts
import { db, sql } from "flypath";
import { table, bigint, text, timestamptz, index } from "flypath/schema";
import { and, count, eq, ilike } from "flypath/sql";
import { migration, createTable, addColumn } from "flypath/migrations";
```

Four modules. `flypath` gains `db` and `sql` on the root — server
implementations in `index.server.ts`, throwing stubs in `index.ts` so a
client component that imports `db` fails at its first call with a sentence
rather than bundling a Postgres client into a phone. `flypath/schema` is
the declaration vocabulary. `flypath/sql` is the expression vocabulary —
operators, functions, aggregates, window functions. `flypath/migrations`
is the operation vocabulary. Three CLI commands: `makemigration`,
`migrate`, `rollback`.

```
src/
  db/
    client.ts        pool per name, ambient transaction lookup, execute
    config.ts        DATABASE_URL, .env, named databases from the vite plugin
    sql.ts           the tag, fragments, raw, ref, join
    expression.ts    Expression<T>, column refs, operators, functions
    scope.ts         type-level scope: Row, Qualified, After<Select>
    query.ts         the pipe builder
    mutate.ts        insert, update, delete
    compile.ts       pipe steps → SQL text + params, the folding rule
    transaction.ts   transaction(), savepoints, the ALS hook
    types.ts         Selectable, Insertable, Updatable, Register lookup
  schema/
    table.ts, column.ts, types.ts, index.ts
  migrations/
    operations.ts    the operation values
    state.ts         replay operations → SchemaState
    diff.ts          SchemaState vs schema module → operations
    order.ts         the compact column order
    writer.ts        operations → a migration file
    runner.ts        migrate, rollback, the tracking table, the lock
    files.ts         discover, number, load
```

## `flypath/schema` — declaring tables

```ts
import {
  bigint,
  check,
  enumType,
  index,
  jsonb,
  table,
  text,
  timestamptz,
  unique,
} from "flypath/schema";

export const status = enumType("post_status", ["draft", "published"]);

export const users = table(
  "users",
  {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    email: text().notNull().unique(),
    name: text(),
    settings: jsonb<{ theme: "light" | "dark" }>().notNull().default({}),
  },
  (t) => [
    index().on(t.name),
    check("email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

export const posts = table(
  "posts",
  {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    authorId: bigint()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: status().notNull().default("draft"),
    body: text().notNull(),
    tags: text().array().notNull().default([]),
  },
  (t) => [
    index().on(t.authorId, t.status),
    index("posts_body_search").using(
      "gin",
      sql`to_tsvector('english', ${t.body})`,
    ),
    unique()
      .on(t.authorId, t.body)
      .where(sql`${t.status} = 'published'`),
  ],
);

declare module "flypath" {
  interface Register {
    schema: typeof import("./schema.ts");
  }
}
```

The key is the column name, verbatim. There is no `casing` option and no
`.name("created_at")` override: the schema is the one place a column is
spelled and every query, migration and row object spells it the same way.
An app that wants `created_at` writes `created_at`.

### Registration

The same `Register` augmentation `routes.ts` uses (`router/types.ts:134`).
`Register["schema"]` is the module's export map; the type layer keeps the
exports that are tables, enums or views and re-keys tables by their SQL
name, so `db().from("users")` is checked against `table("users", ...)`'s
name rather than the export's. With nothing registered, `db()` accepts any
string and returns `Record<string, unknown>` rows — the same degradation
`Href` has when no routes are registered.

### Column types

Every column carries three TypeScript types — what a select returns, what
an insert accepts, what an update accepts — derived from the modifiers
rather than declared (Kysely's `ColumnType`, inferred instead of written):

| declaration                               | select           | insert                    |
| ----------------------------------------- | ---------------- | ------------------------- |
| `text()`                                  | `string \| null` | optional `string \| null` |
| `text().notNull()`                        | `string`         | required `string`         |
| `text().notNull().default("x")`           | `string`         | optional `string`         |
| `bigint().generatedAlwaysAsIdentity()`    | `number`         | not accepted              |
| `bigint().generatedByDefaultAsIdentity()` | `number`         | optional `number`         |
| `text().generatedAlwaysAs(sql\`...\`)`    | `string`         | not accepted              |

Update accepts every insertable column, all optional.

The type census, with the JS mapping each one commits to:

| `flypath/schema`                                                                      | Postgres                   | JS                                                                                          |
| ------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `smallint()`, `integer()`                                                             | `smallint`, `integer`      | `number`                                                                                    |
| `bigint()`                                                                            | `bigint`                   | `number`; throws on parse outside the safe range; `bigint({ mode: "bigint" })` for `bigint` |
| `real()`, `doublePrecision()`                                                         | `real`, `double precision` | `number`                                                                                    |
| `numeric(p, s)`                                                                       | `numeric`                  | `string`                                                                                    |
| `boolean()`                                                                           | `boolean`                  | `boolean`                                                                                   |
| `text()`, `varchar(n)`, `char(n)`                                                     | same                       | `string`                                                                                    |
| `bytea()`                                                                             | `bytea`                    | `Uint8Array`                                                                                |
| `timestamptz()`                                                                       | `timestamp with time zone` | `Date`                                                                                      |
| `timestamp()`                                                                         | `timestamp`                | `Date`, read and written as UTC                                                             |
| `date()`                                                                              | `date`                     | `string` (`YYYY-MM-DD`)                                                                     |
| `time()`, `timetz()`, `interval()`                                                    | same                       | `string`                                                                                    |
| `uuid()`                                                                              | `uuid`                     | `string`                                                                                    |
| `json<T>()`, `jsonb<T>()`                                                             | `json`, `jsonb`            | `T`, default `unknown`                                                                      |
| `enumType(name, values)()`                                                            | the enum                   | the union of `values`                                                                       |
| `inet()`, `cidr()`, `macaddr()`                                                       | same                       | `string`                                                                                    |
| `int4range()`, `int8range()`, `numrange()`, `tsrange()`, `tstzrange()`, `daterange()` | same                       | `string`                                                                                    |
| `tsvector()`                                                                          | `tsvector`                 | `string`                                                                                    |
| `bit(n)`, `varbit(n)`                                                                 | same                       | `string`                                                                                    |
| `point()`                                                                             | `point`                    | `{ x: number; y: number }`                                                                  |
| `any().array()`                                                                       | `T[]`                      | `JS[]`, nested arrays allowed                                                               |
| `custom<T>(sqlType)`                                                                  | anything                   | `T`                                                                                         |

Serial types (`serial`, `bigserial`) are deliberately absent; identity
columns are the Postgres 10+ replacement and the brief uses them. The
`timestamp` row is a decision, not an accident: a timestamp without a zone
has no correct `Date` mapping, so flypath picks UTC on both directions and
documents that `timestamptz` is the one to use.

### Modifiers

`.notNull()`, `.default(value | sql)`, `.defaultNow()`, `.primaryKey()`,
`.unique()`, `.references(() => table.column, { onDelete, onUpdate, deferrable })`,
`.generatedAlwaysAsIdentity({ start, increment })`,
`.generatedByDefaultAsIdentity()`, `.generatedAlwaysAs(sql)` (stored),
`.collate(name)`, `.check(sql)`, `.array()`, `.comment(text)`.

### Table-level

The third argument returns constraints and indexes referencing typed
columns: `primaryKey().on(...)` for composite keys, `unique().on(...)`
with `.nullsNotDistinct()` and `.where(sql)`, `index(name?).on(...)` with
`.using("gin" | "gist" | "brin" | "hash" | "btree")`, `.where(sql)`,
expression members, `.desc()`/`.nullsFirst()` per member, `.include(...)`,
`.concurrently()` as a hint the migration generator honours;
`foreignKey().columns(...).references(table, ...)` for composite keys;
`check(name, sql)`; `exclude("gist", ...)`. Names default to Postgres's
own conventions (`users_email_key`, `posts_author_id_idx`) so a migration
generated by flypath and an index created by hand agree.

### Beyond tables

`enumType(name, values)`, `extension("citext")`, `schema("audit")` with
`.table(...)` for tables outside `public`, `sequence(name, options)`,
`view(name, query)` and `materializedView(name, query)` where `query` is a
`db()` pipe — the view's columns are inferred from the pipe's output row,
so `from("active_users")` is typed without a second declaration. All of
these are exports of `db/schema.ts`, all are diffed into migrations.

## `db()` — the query API

### The pipe model

A query is a sequence of steps. Each step's input is the table the
previous step produced and its output is a new table; the builder's type
parameter is that table's row, so a step can only name columns the table
before it has. This is the single rule that makes the API type-safe, and
it is the reason `.where()` before `.select()` is not merely allowed but
the natural order: `where` sees every column of `users`, `select`
narrows, and a `where` after that `select` sees only what was selected.

| step                                                                        | GoogleSQL                | output table                                  |
| --------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| `from(t)`                                                                   | `FROM`                   | all columns of `t`, qualified and bare        |
| `select(...)`                                                               | `SELECT`                 | exactly the listed columns and aliases        |
| `extend(...)`                                                               | `EXTEND`                 | input plus the new aliases                    |
| `set({...})`                                                                | `SET`                    | input with those columns retyped              |
| `drop(...)`                                                                 | `DROP`                   | input minus those columns                     |
| `rename({...})`                                                             | `RENAME`                 | input with those columns renamed              |
| `as(alias)`                                                                 | `AS`                     | input re-qualified as `alias.*`               |
| `where(...)`                                                                | `WHERE`                  | input                                         |
| `groupBy(...)` / `aggregate(...)`                                           | `AGGREGATE ... GROUP BY` | keys, then aggregates                         |
| `distinct()`, `distinctOn(...)`                                             | `DISTINCT`               | input                                         |
| `orderBy(...)`, `limit(n)`, `offset(n)`                                     | `ORDER BY`, `LIMIT`      | input                                         |
| `join(t, ...)`, `leftJoin`, `rightJoin`, `fullJoin`, `crossJoin`, `lateral` | `JOIN`                   | input plus `t.*` (nullable on the outer side) |
| `union(q)`, `unionAll`, `intersect`, `except`                               | set operators            | input                                         |
| `forUpdate()`, `forShare()`, `.skipLocked()`, `.noWait()`                   | —                        | input                                         |

`db().with("recent", pipe)` and `withRecursive` prefix a pipe with CTEs
and add `recent` to what `from` and `join` accept for the rest of the
chain.

### Scope and references

A column is named as a string — `"id"`, `"users.id"`, `"users.id as
userId"` — checked against the scope by template literal types, exactly
Kysely's trick. A bare name is in scope while it is unambiguous; after a
join that brings a second `id`, only the qualified forms type-check.

Anything that is not a plain column takes a callback receiving the typed
scope:

```ts
import { and, count, eq, ilike, or, rowNumber } from "flypath/sql";

await db()
  .from("posts")
  .where((t) => or(eq(t.authorId, 3), ilike(t.body, "%engine%")))
  .extend((t) =>
    rowNumber()
      .over({ partitionBy: t.authorId, orderBy: [t.id, "desc"] })
      .as("rank"),
  )
  .where("rank", "<=", 3)
  .select("id", "body", "rank");
```

`t.id` and `t["posts.id"]` are `Expression<number>` values; `flypath/sql`
functions take expressions and plain values and return expressions; `eq(t.id, "x")`
fails to type-check. A `sql` fragment is an expression of whatever type it
is given: `sql<number>\`length(${t.body})\`.as("len")`.

The triple form `where("id", "=", 3)` is the same thing with the callback
removed for the common case. The operator set is Postgres's: `=`, `<>`,
`<`, `<=`, `>`, `>=`, `in`, `not in`, `is`, `is not`, `is distinct from`,
`like`, `ilike`, `not like`, `not ilike`, `~`, `~*`, `@>`, `<@`, `&&`,
`?`, `?|`, `?&`, `between`. The value's type follows the column and the
operator — an array for `in`, `null` or a boolean for `is`, a string for
`like` — and it may be a subquery or an expression instead of a value.
Repeated `where` steps are `AND`ed.

### Joins

```ts
db()
  .from("posts")
  .join("users", "users.id", "posts.authorId")
  .leftJoin(
    db().from("likes").groupBy("postId").aggregate(count().as("likes")).as("l"),
    "l.postId",
    "posts.id",
  )
  .select("posts.id", "users.name as author", "l.likes");
```

Two-column shorthand or a callback returning a boolean expression. A
joined pipe is aliased with `as()` and contributes its output row; the
outer side of an outer join has its columns widened with `null`.
`lateral(pipe)` is a `CROSS JOIN LATERAL` whose pipe may reference the
outer scope in its callbacks.

### Aggregation

```ts
db()
  .from("posts")
  .groupBy("authorId")
  .aggregate((t) => [count().as("posts"), max(t.id).as("latest")])
  .where("posts", ">", 10)
  .orderBy("posts", "desc");
```

`groupBy` alone is a `SELECT keys ... GROUP BY keys`; `aggregate` alone is
a whole-table aggregate; together they are one `SELECT`. The callback in
`aggregate` sees the row scope from before `groupBy`, the steps after it
see keys then aggregates. `where` after an aggregate is a `HAVING` — the
builder does not have a `having` method because pipe syntax does not.

### Subqueries and CTEs

A pipe is an expression where an expression is accepted: in `where`
(`in`, `exists`, comparisons against a scalar pipe), in `select`/`extend`
as a scalar, in `from` and `join` as a table. `jsonAgg(pipe)` and
`jsonObject(pipe)` in `flypath/sql` are the nested-select helpers (Kysely's
`jsonArrayFrom`/`jsonObjectFrom`) and type their result from the inner
pipe's row, which is how one round trip returns a post with its comments.

### Insert, update, delete

```ts
await db().into("users").insert({ email, name }).returning("id");
await db().into("users").insert(rows).onConflict("email").doNothing();
await db()
  .into("users")
  .insert({ email, name })
  .onConflict("email")
  .doUpdate({ name: excluded("name") })
  .returning("id", "name");
await db().into("archive").insert(db().from("posts").where("status", "=", "draft"));

await db().update("users").where("id", "=", 3).set({ name });
await db().update("users").set({ name }).where("id", "=", 3).returning("id");
await db().update("posts").from("users").where(...).set((t) => ({ body: concat(t.users.name, ": ", t.posts.body) }));

await db().delete("posts").where("id", "=", 3);
await db().delete("posts").using("users").where(...).returning("id");
```

`insert` takes `Insertable<T>` — identity-always columns rejected,
defaults optional — one row, an array, or a pipe. `set` takes
`Updatable<T>`, or a callback for expressions. `where` and `set` accept
either order because both are in scope from the table; `returning` closes
the chain and types the result. `onConflict` takes a column list, a
constraint name, or `{ target, where }` for partial indexes;
`doUpdate` accepts `excluded(col)` and a `where`.

### Execution

A pipe is thenable. `await pipe` runs it and returns `Row[]`;
`.first()` returns `Row | undefined`; `.firstOrThrow()` throws
`NotFoundError`; `.stream()` is an async iterable over a cursor for
result sets that should not be materialized; `.compile()` returns
`{ text, params }` and never touches the pool; `.explain()` returns the
plan. Mutations return `{ count }` unless `returning` was called. Nothing
executes until awaited, so a pipe is a value that can be built up across
functions and passed around.

Rows are plain objects keyed by output column name. Parsing is per
Postgres type OID via postgres.js's `types` map, overridden for `bigint`
(safe-range check), `timestamp` (UTC), `numeric` (string), `date`
(string). No result caching; `React.cache()` is the app's tool for
deduplicating within a render and it already exists.

### The compiler and the folding rule

Pipe steps do not map one-to-one onto a `SELECT`. The naive lowering wraps
each step in a subquery — correct, and what ZetaSQL does before its
planner flattens — but the SQL it prints is unreadable in a log and
Postgres's subquery pull-up has limits. The compiler keeps one open
`SELECT` and folds a step into it when SQL's clause order allows:

```
FROM → JOIN → WHERE → GROUP BY → HAVING → select list → DISTINCT → ORDER BY → LIMIT → locking
```

A step folds if its clause is at or after the furthest clause already
filled, and if every name it references resolves to a base column of the
open `SELECT` rather than to an alias projected by it. Otherwise the open
`SELECT` becomes `(...) AS _1` and the step opens a new one over it. Two
exceptions are deliberate: `where` after `groupBy`/`aggregate` folds as
`HAVING`, and `orderBy` of a bare projected alias folds because Postgres
allows output names there.

So `from → where → select → orderBy → limit` is one `SELECT`;
`from → extend(rowNumber…) → where("rank", "<=", 3)` is two, because the
window alias is not visible to `WHERE` in the same level — which is
exactly the subquery a person would write. `select *` is never emitted;
the select list is always the explicit scope, so physical column order is
invisible to the app and the compact ordering in migrations is free.

Compiled text is stable for a given chain shape, so postgres.js's
prepared-statement cache hits.

### Transactions

```ts
await transaction(async () => {
  const [post] = await db().into("posts").insert({ ... }).returning("id");
  await db().into("likes").insert({ postId: post.id, userId });
});
```

`transaction(fn, { isolation, readOnly, deferrable })` reserves a
connection, `BEGIN`s, runs `fn` inside an `AsyncLocalStorage` scope that
holds the connection, and every `db()` or ` sql` `` call in that scope
uses it. Nested `transaction` is a savepoint. Throwing rolls back;
returning commits. The callback receives nothing because it needs nothing:
`db()` is ambient in the same way `params()` and `cookies()` are ambient
inside a request, and it is the same primitive (`platform-store.ts`) doing
the work. `transaction` is exported from `flypath` next to `db`.

### Connections and `db(options)`

`db()` returns a handle bound to the default database; `db({ name:
"replica" })` binds to a named one. Pools are created lazily per name, held
on `globalThis` under a key the way `platform-store.ts` holds the request
storage, so a Vite module re-evaluation in dev does not leak a pool, and
closed on server shutdown.

Configuration is split the way plan 13 split it: secrets in the
environment, shape in the vite plugin. `DATABASE_URL` is the default
database with no configuration at all. `flypath({ databases: { replica: { url: process.env["REPLICA_URL"], max: 4 } } })`
declares named ones and pool options. The CLI and the dev server call
Node's `process.loadEnvFile()` on `.env` when it exists — Node 24 has it
built in, so no `dotenv` — before either the vite config or `db()` reads
the environment.

### Server-only

`db`, `sql` and `transaction` are exported from `index.server.ts`.
`index.ts` exports three functions with the same signatures that throw
`"flypath: db() only runs on the server; call it from a server component,
a server action or a middleware"`. The postgres.js import lives in
`db/client.ts`, which nothing in the client or native graph reaches, so
the stub is enough and no bundler rule is needed.

## `sql` — the tag

```ts
const rows = await sql<{ id: number; body: string }>`
  select id, body from posts where author_id = ${authorId} and status = ${status}
`;
```

Interpolated JS values become `$n` parameters. Interpolated expressions —
column refs from a scope, other `sql` fragments, pipes — are inlined as
SQL. `sql.ref("users.id")` for an identifier, `sql.raw(text)` for trusted
text, `sql.join(list, separator)` to expand a list of fragments or values,
and arrays interpolate as Postgres array parameters so `= any(${ids})` is
the idiom rather than `in (...)`. A `sql` value is thenable (executes on
the ambient connection, typed by the generic) and is an `Expression`
(embeds in the builder, typed by the generic). It is one type doing both
jobs, the way postgres.js's `sql` and Kysely's `sql` each do half.

## Migrations

### Files

```ts
import { createTable, migration } from "flypath/migrations";
import { bigint, text, timestamptz } from "flypath/schema";

export default migration([
  createTable("users", {
    id: bigint().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamptz().notNull().defaultNow(),
    email: text().notNull().unique(),
    name: text(),
  }),
]);
```

`db/migrations/YYYYMMDDHHMMSS_name.ts`, a UTC timestamp to the second the
way Rails names them, ordered by that timestamp. Columns in a migration
are written with the same `flypath/schema` builders as the schema, so the
two files share one vocabulary and one parser. The generator sorts
`createTable` columns into compact order; the developer's `schema.ts`
keeps whatever order reads best.

No `dependencies` list: Django's graph exists for many apps and flypath
has one. The merge story is Rails': two branches each add a migration,
the timestamps differ, both files land, and `migrate` applies whichever
is pending regardless of whether something newer is already applied.
Replay for `makemigration` is in timestamp order, so after a merge the
next `makemigration` shows any drift the two branches produced together,
and `--check` in CI catches it. Two files with the same timestamp is an
error with both names printed.

### Operations

`createTable(name, columns, extras)`, `dropTable`, `renameTable`,
`addColumn(table, name, column)`, `dropColumn`, `renameColumn`,
`alterColumn(table, name, { type, using, notNull, default })`,
`createIndex(table, index)` with `concurrently`, `dropIndex`,
`addConstraint`, `dropConstraint`, `createEnum`, `addEnumValue`,
`renameEnumValue`, `dropEnum`, `createExtension`, `dropExtension`,
`createSchema`, `dropSchema`, `createSequence`, `dropSequence`,
`createView`, `dropView`, `createMaterializedView`, `dropMaterializedView`,
`sql({ up, down? })`, `run({ up, down? })`.

`run` callbacks receive nothing and use the `sql` tag on the migration's
connection, which is ambient exactly as inside `transaction`. No
historical models: a data migration writes the SQL it needs against the
schema as it is at that point in history, which the file above it in the
directory makes visible.

Every structural operation computes its inverse from the state before it
— `dropColumn`'s inverse is `addColumn` with the column definition the
state holds — so `rollback` needs no hand-written `down`. `sql` and `run`
without `down` make the migration irreversible and `rollback` says so by
name before touching anything.

### State replay and the diff

`makemigration` loads every migration file in order through Vite's
`runnerImport` (so `.ts`, `flypath/schema` and project imports resolve
exactly as they do in the app), folds the operations into a `SchemaState`
— tables, columns with full definitions, indexes, constraints, enums,
extensions, schemas, sequences, views — then loads `db/schema.ts` and
builds the same structure from its exports. The diff walks both and emits
operations in dependency order: extensions and enums and schemas first,
tables in reference order, then columns, constraints, indexes, views;
drops in reverse.

Ambiguities are prompted, Django-style, and answered non-interactively by
`--no-input` with the conservative choice:

- a dropped column beside an added column of the same type: rename?
- a dropped table beside an added table with the same columns: rename?
- a `notNull()` column added to a table with no default: supply a
  one-time default for existing rows, or abort.
- an enum value removed: Postgres cannot; the generator emits the
  create-new-type-and-cast sequence and says so.

`--name` overrides the generated name; the generated one is derived from
the operations (`20260905093012_add_posts`, `20260906120000_alter_users_name`). `--check`
exits 1 if the diff is non-empty and writes nothing, for CI. `--empty`
writes a migration with no operations, for data migrations.

### The column order

`migrations/order.ts` owns one function: given a table's columns, return
the physical order. Fixed-width columns first, sorted by alignment then by
size, both descending, stable by declaration order within a tier;
variable-width columns last, in declaration order. The table it consults:

| tier                       | types                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 8-byte alignment, 16 bytes | `interval`, `point`                                                                                                                      |
| 8-byte alignment, 8 bytes  | `bigint`, `double precision`, `timestamp`, `timestamptz`, `time`, `money`                                                                |
| 8-byte alignment, 12 bytes | `timetz`                                                                                                                                 |
| 4-byte alignment, 4 bytes  | `integer`, `real`, `date`                                                                                                                |
| 4-byte alignment, 6 bytes  | `macaddr`                                                                                                                                |
| 2-byte alignment           | `smallint`                                                                                                                               |
| 1-byte alignment, fixed    | `boolean`, `uuid`                                                                                                                        |
| variable                   | `text`, `varchar`, `char`, `bytea`, `numeric`, `json`, `jsonb`, `inet`, `cidr`, ranges, `tsvector`, `bit`, arrays, enums as 4-byte fixed |

Enums are 4-byte OIDs and sort with `integer`. The generator applies this
to `createTable` only; `addColumn` cannot reorder and the diff never
proposes a rewrite to fix order. The rule is silent: the app never sees
the order, so there is nothing to warn about.

### `migrate` and `rollback`

`flypath_migrations (name text primary key, applied_at timestamptz not null)`
is created on first run. `migrate` takes `pg_advisory_lock` on a fixed
key, lists files, refuses on a duplicate timestamp or an applied name with
no file (Rails' `NO FILE`), then applies each pending file in timestamp
order — including one older than the newest applied, which is what a
merged branch looks like — inside its own transaction and inserts the row
in the same transaction. `migration(ops, { transaction: false })` opts a
file out for `createIndex` with `concurrently` and `addEnumValue` before
Postgres 12; the runner refuses a non-transactional file that mixes in
other operations. `--to <timestamp>` stops early; `--plan` prints what would run;
`--sql` prints the SQL (Django's `sqlmigrate`); `--status` lists applied
and pending; `--check` exits 1 if anything is pending.

`rollback` reverses the last applied migration by default, `--step n`
for several, `--to <timestamp>` down to and excluding a name, each in its own
transaction, deleting the tracking row as it goes.

`flypath dev` runs the status check once at startup when `DATABASE_URL`
is set and prints pending migrations as a warning. It does not apply them:
that is a decision, and the dev server is not where it is made.

## What changes

- `package.json`: `postgres` dependency; `./schema`, `./sql`,
  `./migrations` exports; `vitest` as a devDependency; `test` and
  `test:watch` scripts.
- `vitest.config.ts` at the root; `tsconfig.json` excludes `*.test.ts` and
  `*.test-d.ts` from the build.
- `src/index.server.ts`, `src/index.ts`: `db`, `sql`, `transaction`, and
  the `Register["schema"]` slot; types `Selectable`, `Insertable`,
  `Updatable`, `Expression`, `Database`.
- `src/cli.ts`: `makemigration`, `migrate`, `rollback`; `dev` gains the
  startup status check and the `.env` load.
- `src/native/config.ts`: `databases` on `FlypathOptions`.
- `src/db/`, `src/schema/`, `src/migrations/`: new.
- `knip.json`: the three new entry points, the example's `db/**`.
- `example/db/schema.ts`, `example/db/migrations/20260904150000_initial.ts`,
  `example/.env`; `example/app/posts.ts`, `actions.ts`, `session.ts`
  rewritten over `db()`.

## Tests

The repository has none. This plan adds the first, and the shape it picks
is the one later suites inherit.

**Vitest, not `node:test`.** Node 24 runs `.ts` files directly and
`node --test` has snapshots, so the zero-dependency option is real. Three
things tip it. Type assertions are half of what this plan has to check,
and `vitest --typecheck` runs `*.test-d.ts` files through `tsc` with
`expectTypeOf(row).toEqualTypeOf<{ id: number }>()`, where `node:test`
offers nothing and the alternative is `@ts-expect-error` lines counted by
hand. The compiler's golden SQL wants inline snapshots so the text sits
beside the chain that produced it; Vitest has `toMatchInlineSnapshot` and
`node:test` writes snapshots to a side file. And flypath is a Vite
project: Vitest resolves `.ts` imports, the `flypath/*` self-references
and, later, `virtual:` modules exactly as the app's own build does, which
`node:test` cannot without a loader. One devDependency.

**Co-located, two suffixes.** `src/db/compile.test.ts` beside
`src/db/compile.ts` for behaviour, `src/db/scope.test-d.ts` for types, no
`tests/` directory: a test far from its subject is a test nobody updates.
`tsconfig.json` excludes both patterns from the build so `dist/` stays
clean; `vitest.config.ts` sets `typecheck.include` to both patterns so
`.test.ts` files are type-checked as well as run. `pnpm test` is
`vitest run --typecheck`; `pnpm test:watch` is the watch mode.

**Names.** One `describe` per exported function, `describe("compile")`;
each `it` a sentence stating the behaviour, not the input:
`it("folds where before select into one statement")`,
`it("wraps where after a window extend")`. A test's name is what a
failure prints, so it is written for the person reading the failure.

**One suffix, and Postgres is a given.** Every behaviour test is
`*.test.ts`; there is no second suffix for the ones that talk to a
database. `compile`, `order`, `state` and `diff` are pure and are tested
pure, but the executor, `transaction` and the migration runner need
Postgres, and running the suite requires one: `TEST_DATABASE_URL`, or
`postgres://localhost/flypath_test` when it is unset. Each such file
creates and drops its own schema (`flypath_test_<random>` on
`search_path`) so they run in parallel against one database and leave
nothing behind.

**The example is not unit-tested.** It is exercised by the milestone, on
three platforms, by a person.

## Phases

### Phase 0 — a connection and the tag

`db/config.ts`, `db/client.ts`, `db/sql.ts`, the server/client export
split, `.env` loading in the CLI and dev server.

Acceptance: a server component in the example awaits
`` sql<{ n: number }>`select ${1}::int as n` `` against the local Postgres 18;
the same import in a `"use client"` file throws the sentence at call time
and the client bundle contains no `postgres` code.

### Phase 1 — the schema vocabulary

`schema/*`, `Register["schema"]`, `Selectable`/`Insertable`/`Updatable`.

Acceptance: `example/db/schema.ts` declares the five tables and an enum;
`Insertable<typeof users>` rejects `id` and requires `email` under `tsc`;
`db().from("nope")` is a type error.

### Phase 2 — the pipe, read side

`db/scope.ts`, `expression.ts`, `query.ts`, `compile.ts` with the folding
rule, execution, `flypath/sql` operators and scalar functions, and the
first tests: `compile.test.ts` with an inline SQL snapshot per step
combination, `scope.test-d.ts` with the type assertions.

Acceptance: `from → where → select → orderBy → limit` compiles to one
`SELECT` with `$1` params; `extend(window) → where` compiles to two; every
example in this plan's query section type-checks and the negative cases
(`eq(t.id, "x")`, a bare `id` after a join) do not.

### Phase 3 — the rest of the read side

Joins, `extend`/`set`/`drop`/`rename`/`as`, `groupBy`/`aggregate`,
`distinct`, set operators, `with`, subqueries as expressions, `jsonAgg`,
window functions, locking, `stream()`.

Acceptance: the feed query — posts joined to users, like counts
aggregated in a joined pipe, ordered, limited — is one `db()` chain, one
round trip, and its row type is inferred.

### Phase 4 — the write side and transactions

`db/mutate.ts`, `transaction.ts` with the ALS hook, savepoints.

Acceptance: `likePost` is an `insert … on conflict do nothing` plus a
count in one transaction; a throw inside `transaction` leaves no row;
nested `transaction` produces `SAVEPOINT` in the log.

### Phase 5 — migrations, running

`migrations/operations.ts`, `state.ts`, `runner.ts`, `files.ts`, the
tracking table, `migrate` and `rollback` commands with their flags.

Acceptance: a hand-written `20260904150000_initial.ts` for the example applies,
`--status` shows it, `rollback` removes every object it created, a second
`migrate` reapplies it; a `sql` operation without `down` is refused by
`rollback` by name.

### Phase 6 — migrations, generating

`migrations/diff.ts`, `order.ts`, `writer.ts`, the prompts,
`makemigration` with `--name`, `--check`, `--empty`, `--no-input`.

Acceptance: the milestone. `makemigration` on a fresh example writes
`<timestamp>_initial.ts` with `users.id`, `createdAt` (8-byte) before `email`,
`name` (variable); running it again writes nothing; adding `bio: text()`
to `users` writes `<timestamp>_add_users_bio.ts` containing one `addColumn`;
renaming `name` to `displayName` prompts and, answered yes, writes a
`renameColumn`.

### Phase 7 — the example earns it

`posts.ts`, `actions.ts`, `session.ts` over `db()`; the dev-server
pending-migration warning.

Acceptance: the milestone on browser, simulator and emulator, with the
dev server restarted between steps and the data still there.

## Key decisions

- **Pipeline order is the type system.** Each step sees only the previous
  step's output. This is what makes `where` before `select` natural, what
  makes `having` and `qualify` unnecessary, and what keeps the type
  machinery to one row type per step instead of Kysely's union of
  everything ever mentioned.
- **Strings for columns, callbacks for expressions.** `"users.id"` is
  checked by template literal types and needs no import; anything with an
  operator in it takes `(t) => ...` so the expression functions receive
  typed refs. Two forms, one boundary: is it a column name or not.
- **Tables by name, not by object.** `from("users")` against the
  registered schema, mirroring `href("/p/:id")` against the registered
  routes. Passing the `users` object as well would be a second way to say
  the same thing.
- **The schema file is authored; migrations are derived; history is the
  snapshot.** Django's model. No `meta/` directory, no `schema.rb`, no
  shadow database, nothing generated that lives in the repository except
  the migrations themselves.
- **Migrations are data, so they reverse themselves.** A `createTable`
  value knows it is a `dropTable` in reverse. Hand-written `down` exists
  only where it must (`sql`, `run`).
- **One vocabulary for schema and migrations.** A column in a migration is
  a `flypath/schema` column. The generator writes what the developer would
  write, and the replayer parses what the developer could write by hand.
- **Compact column order is the generator's job.** The developer's
  `schema.ts` reads top-down; `createTable` is sorted; `select *` is never
  emitted so nothing observes the difference.
- **Ambient transactions.** `transaction(fn)` puts the connection in the
  request store and `db()` finds it there. Same mechanism as `params()`
  and `cookies()`, no `tx` parameter to thread, no way to forget to use it.
- **Column names are literal.** No snake_case mapping, no `.name()`. One
  spelling everywhere.
- **`bigint` is a `number`.** Identity keys are what `bigint` is for in
  practice, and a `number` that throws past 2^53 is more honest than a
  `bigint` that poisons every arithmetic site. `{ mode: "bigint" }` for
  the rare genuine case.
- **postgres.js, as a direct dependency.** Pure JS, one package, and the
  fast one. Flypath wraps it rather than exposing it; the `types`,
  `transform` and template features it has are not part of flypath's API.
- **Timestamps, no dependency graph.** Rails' naming. Sequential numbers
  collide on every pair of branches and force a renumber that rewrites
  history; a timestamp to the second does not collide in practice and
  says when the migration was written, which is the fact a reader wants.
  Ordering ambiguity between branches is resolved by `migrate` applying
  whatever is pending and `makemigration` replaying in timestamp order.
- **The compiler gets tests, on Vitest.** The first tests in the
  repository, because a compiler's correctness is textual and enumerable
  and the folding rule has more cases than a person can hold while
  editing. The shape is in the Tests section and is the shape later tests
  follow.
- **`flypath/sql` is a separate module from the `sql` tag.** The tag is
  one export on the root; the forty-odd operators and functions would
  crowd it, and `flypath/router` sets the precedent for a vocabulary
  module.

## Not in this plan

A relational query API (`findMany({ with: { posts: true } })`) — the pipe
with `jsonAgg` covers nested reads, and a second query language is a
second thing to type. Introspection from a live database (`pull`); seeds
as a command (`run` in a migration does the example's job); other
dialects; query logging beyond `.compile()`; `LISTEN`/`NOTIFY`; `COPY`. Each is reachable from this foundation and none
changes its shape.

## Risks / open questions

- **Type instantiation cost.** Template-literal column parsing and
  per-step row types are exactly what makes Kysely slow in editors on wide
  schemas. Phase 2 measures `tsc --extendedDiagnostics` on a
  thirty-table schema before Phase 3 adds joins; the mitigation is
  restricting the qualified-name space to tables actually in scope, which
  the pipe model already implies.
- **The folding rule's edge cases.** `distinctOn` and `orderBy`
  interaction, `set` referencing a column being replaced, `rename` of a
  column a later `where` uses, `union` of pipes with different folded
  depth. Wrapping is always correct, so the failure mode is ugly SQL rather
  than wrong SQL, and the golden tests are where the ugliness gets found.
- **Postgres subquery pull-up limits.** A wrapped level with a window
  function, `DISTINCT` or `LIMIT` cannot be flattened by the planner. That
  is the semantics the developer asked for, but a `where` after `extend`
  that the developer meant as a plain filter will run as a subquery filter.
  Documenting "filter before extend" is the only answer.
- **`runnerImport` in production.** `migrate` on a deploy target loads
  `.ts` through Vite. `vite` is a dependency of `flypath` so it is present,
  but it is a heavier thing to start than a migration runner should be.
  Compiling `db/migrations` into `dist/` at `flypath build` is the fallback
  if it bites.
- **The replay vocabulary must match the schema vocabulary exactly.** Any
  column option the schema accepts that the replayer ignores produces a
  diff every run. The mitigation is structural: both read the same column
  value, so the gap can only open if `SchemaState` normalizes lossy-ly —
  defaults expressed as `sql` fragments are the likely case and compare as
  text.
- **Prompting from the CLI.** `cac` has no prompt; `node:readline` does
  the job, but a `makemigration` in CI without `--no-input` will hang on
  a rename question. It will detect a non-TTY and behave as `--no-input`.
- **`timestamp` as UTC** will surprise someone with an existing database
  full of local-time timestamps. The framework has no existing databases
  yet; this is the moment to pick the correct default.
- **Ambient transactions and concurrency.** `Promise.all` inside
  `transaction` serializes on one connection, which is correct and
  slower than the developer may expect. A `db()` call that escapes the
  scope — a callback stored and invoked after commit — silently uses the
  pool. Both are documented behaviours of every ALS-based transaction
  manager (Django's `atomic`, Rails' connection pool) and not new.
- **Enum value removal** and **column type changes with data** are the two
  operations Postgres makes genuinely hard; the generator emits the
  known-correct sequence with a `using` slot and prints a warning, and
  does not pretend the migration is safe on a large table.
- **The example needs a running Postgres.** Homebrew's `postgresql@18` is
  running on this machine; the example's `.env` points at
  `postgres://localhost/flypath_example` and the milestone assumes the
  database exists. A `flypath db create` command is not in scope.
