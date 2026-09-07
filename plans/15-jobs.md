# Flypath — jobs and crons

## Goal

Give a flypath app background work. Any exported async function is a
job; a request enqueues it by writing the call it wants made; a worker
somewhere else makes that call later, once, with retries, on a schedule
if asked.

```ts
import { jobs } from "flypath";

import { resize } from "./images.ts";

await jobs().enqueue(() => resize(post.id));
await jobs().enqueue(
  () => resize(1),
  () => resize(2),
  () => resize(3),
);
await jobs({ queue: "images", priority: 10 }).enqueue(() =>
  resize(post.id, 1024),
);
await jobs({ unique: true }).enqueue(refreshFeeds);
```

```ts
// app/crons.ts
import { cron } from "flypath";
import { digest } from "./reports.ts";

export default [
  cron("0 7 * * *", () => digest("daily"), { timezone: "Europe/Lisbon" }),
];
```

Postgres is the queue: one table, six statements, `FOR UPDATE SKIP
LOCKED`, `LISTEN`/`NOTIFY` for latency and a poll for truth. `flypath
work` is a worker; run as many as you like and no two will run the same
job. `flypath dev` runs one in-process.

Milestone: `postNote` in `example/app/actions.ts` enqueues
`() => notifyMentions(note.id)` inside the same transaction that inserts the
note; `flypath dev` runs it within a second of the commit without any
polling delay; a second `flypath work` in another terminal and the first
never double-run a burst of fifty; enqueueing the same call twice with
`unique: true` produces one row; a job that throws is retried per its
queue's policy and then lands in `failed`; a job that outlives its
timeout is retried and its late result is discarded; `app/crons.ts`
schedules a nightly prune that two workers fire exactly once between
them.

## What is missing today

**There is no way to do anything after the response.** Every server action
in `example/app/actions.ts` does its work inline and returns. `TODO` lists
"Jobs, Crons".

**The pieces a queue needs already exist.** `pool()` and `connection()`
(`db/client.ts`) hand out a `postgres` connection that respects the ambient
`db.transaction()` scope, which is exactly what makes "enqueue inside my
transaction" free — and `NOTIFY` inside a transaction is delivered at
commit, so a wake-up can never precede the row. porsager's `sql.listen`
opens its own connection and re-subscribes after a drop
(`postgres/src/index.js:157`), so reconnect handling costs nothing.
`singleton()` (`globals.ts`) is process-global state that survives module
re-evaluation in the Vite runner, which is what a registry of job
functions needs in dev. `ensureTable()` in `migrations/runner.ts` is the
precedent for a framework-owned table installed with idempotent DDL
under an advisory lock. `loadOptions()` (`native/config.ts`) reads
`vite.config.ts` from the CLI, which is where queue configuration goes.
`clientReferences()` (`vite/index.ts`) already builds a registry module
from a directory listing, and `extractStyles()` (`vite/extract.ts`)
already rewrites call sites with `oxc-parser` and `magic-string`;
together they are the shape of job discovery.

**The server entry is the only production artefact.** `flypath build`
produces `dist/rsc/index.js` and there is no `flypath start`; a worker has
to load application code the same way a server would, so it loads that file.

## Field notes — prior art

- **GoodJob** (Rails, Postgres). One `good_jobs` table; a worker takes a
  job with a session advisory lock (or `FOR UPDATE SKIP LOCKED`, or both
  during a rolling deploy); `LISTEN good_job` wakes workers and a 10 s poll
  backs it up. Queues are named and a worker declares pools as
  `"critical:2;default:1;*"`. Cron is a hash in the Rails config; every
  process evaluates it and a unique index on `(cron_key, cron_at)` makes
  the concurrent inserts collapse to one. The lessons this plan takes:
  LISTEN/NOTIFY is a latency hint over a polling loop, never the source
  of truth; cron dedup is a unique index, never a leader.
- **huey `PostgresStorage`** (`huey/storage.py`). Dequeue is one
  statement:
  `delete from task where id = (select id … order by priority desc, id limit 1 for update skip locked) returning data`.
  Enqueue does `pg_notify('huey.q.<queue>', '')`; the consumer blocks on a
  dedicated LISTEN connection with a timeout and then dequeues. Tasks are
  identified by module path plus function name and the consumer imports
  the task modules to populate a registry. The lessons: the claim is a
  single statement with a locking subquery; identity is module plus name;
  the consumer's job is to import everything.
- **graphile-worker** (Node, Postgres). `LISTEN jobs:insert` plus a poll;
  a `known_crontabs` table for cron dedup; 25 attempts with exponential
  backoff by default; no per-job timeout; a `queue_name` means serial.
- **pg-boss 12** (Node, Postgres). Does everything in the brief — SKIP
  LOCKED, opt-in LISTEN/NOTIFY with a 30 s poll behind it, per-queue
  retry and expiry policies, `singletonKey` dedup, cron with clock-skew
  correction, an adapter seam our pool could sit behind — and was this
  plan's first choice. Measured: 23 packages and 7.6 MB in
  `node_modules` (`luxon` alone is 4.5 MB), roughly 11,000 lines of
  library on the code path, a second Postgres driver we would never
  open, an external schema with its own versioning, and an adapter whose
  compatibility with porsager's type parsing was the plan's top risk.
  The glue would have been ~200 lines; the custom queue below is ~500.
  Three hundred lines bought all of that back, so the custom route won.
  Its design is still the reference: resolved policy stored on the row,
  `short`-style "one queued per key", a worker id fencing late writes.
- **DBOS on LISTEN/NOTIFY.** `NOTIFY` takes a global lock at commit that is
  held until the transaction is flushed, so notifying transactions
  serialise and the database tops out near 3K such commits per second.
  Their fix keeps LISTEN/NOTIFY but stops notifying per write: writers
  buffer and flush notifications in batches, readers poll at a low rate to
  catch anything a crash lost. The takeaway for a queue: notify is a
  per-queue latency knob you turn off on a hot queue, not something every
  insert is entitled to.
- **RSC server references.** `"use server"` turns an export into
  `{ $$id: "module#name" }` and a manifest maps ids back to chunks. It is
  the closest thing in the codebase to "serialise a function", and it is
  also the reason a job must never be exported from a `"use server"`
  module: that export is a public endpoint.
- **croner.** A cron parser with `nextRun(from)`, IANA timezones via
  `Intl`, 164 KB, no dependencies. The only dependency this plan adds.
- **Comlink / `worker_threads`.** Useful only if a job must be killed or
  must not share the event loop with the server. Neither is required
  here; see "Options considered".

## Options considered

### Library or custom

See the pg-boss note above for the numbers. The deciding argument is not
size alone: the framework already owns its migrations and query builder,
declares Postgres-only with `FOR UPDATE SKIP LOCKED` as a first-class
feature (plan 14), and every statement the queue needs is one the `sql`
tag can express. A job table in the framework's own vocabulary, installed
the way `flypath_migrations` is installed, is the on-brand answer, and
what pg-boss would have added beyond the brief — dead-letter queues,
heartbeats, partitioning, flows, a dashboard — is not in the brief.

**Decision: custom, one table, on the existing pool.** One dependency,
`croner`, for cron expressions and timezones; writing a correct
five-field parser with DST-safe timezones is not where the lines should
go.

### How a call becomes data

`enqueue(() => resize(1, "hello"))` has to become `{ function, args }`
without running `resize`. Four ways:

1. **A wrapper at the definition**, `export const resize = job(async …)`.
   The wrapper notices it is being called inside a recording scope and
   records instead of running. Zero transforms, but every job carries a
   level of indirection that exists for the framework, not the user, and
   "is this a job" becomes a category to get wrong.
2. **A full compile-time rewrite** of the arrow into
   `{ id: "app/images.ts#resize", args }`. Needs import resolution, scope
   analysis and a build manifest at every call site. RSC-sized.
3. **A syntactic rewrite** of the arrow into `() => [resize, [1, "hello"]]`.
   The callee and the arguments stay live expressions; nothing is
   resolved at the call site. At runtime `enqueue` calls the thunk, gets
   `[fn, args]`, and looks `fn` up in a reverse map. Forty lines.
4. **An explicit tuple**, `enqueue(resize, 1, "hello")`. No rewrite at
   all, same reverse map. Reads worse for bulk enqueue and for crons and
   saves only the forty lines.

**Decision: (3).** The closure syntax survives verbatim, there is no
wrapper, and any exported async function in the project is a job. The
rewrite's rule is one sentence: the argument to `enqueue` or `cron` must
be an arrow literal whose body is exactly one call, optionally under
`await`, or a bare function reference. Anything else is a build error at
that line.

### Identity and discovery

The reverse map has to be built from somewhere, and the worker has to
evaluate the job modules before it can run anything, in production as
well as in dev. Both come from one scan. `virtual:flypath/jobs` is
generated by finding every `enqueue` and `cron` call site, resolving each
callee through its import declaration (or its same-module export) to a
file plus export name, importing those files, and registering
`"app/images.ts#resize" → m0.resize`. The id is the path relative to the
project root plus the export name, so renaming a file or an export
changes the id and queued rows for the old id fail with "no job
registered as …" instead of silently running something else.

The scan is where the resolution logic lives, once, at build time, with
the plugin's `this.resolve` available for aliases. It is roughly 150
lines and it was needed in some form under every option above because
production has no other way to know which modules a worker must load.

What the scan rejects, with a file and line: a callee that is not bound
to an import or a top-level export (a local closure, a method, a
parameter), a callee from `node_modules`, and a callee whose module
carries a `"use server"` directive. The last one is a security check, not
a convenience: a function exported from `actions.ts` is already a public
endpoint, and a job should not be.

### Locks

Session advisory locks (GoodJob's default) release the instant a worker's
connection dies, which is their appeal; the cost is one lock per active
job held on a pooled connection for the job's whole duration, which
fights a pool of ten. `FOR UPDATE SKIP LOCKED` inside a single `UPDATE`
takes the row lock only for the claim and writes `locked_at`/`locked_by`
instead; a dead worker is then detected by the expiry sweep rather than
by lock release. Given a per-job `timeout` exists anyway, the sweep is
the same code path, so there is no second mechanism to add.
**Decision: SKIP LOCKED claim, sweep for the dead.**

### Process shape

`flypath work` is a process; concurrency inside it is promises, sized per
queue. There is no `worker_threads` layer: the fetch loop and the handlers
are I/O bound, and the dev server already runs the RSC environment in the
main thread through the module runner, which is precisely where an
in-process worker can `runner.import` the same modules the routes use. A
thread would need its own module runner and transport in dev for no gain
today. Timeouts are therefore cooperative — see "Timeouts".

### Where crons live

Not `vite.config.ts`. The config is evaluated by Vite before the app's
module graph exists, outside every transform (`css`, `virtual:` modules,
the `react-server` condition, and now the `enqueue` rewrite), so
`() => report(1, 2, 3)` there would import application code into the
wrong world. `app/crons.ts` is loaded by the worker through the same
environment as routes, next to `app/routes.ts` which already sets the
convention. Queue _configuration_ does go in `vite.config.ts`, beside
`databases`.

### Schema

The table is framework-owned, like `flypath_migrations`, and installed
the same way: idempotent DDL under the migration advisory lock, run by
`flypath migrate` and by every worker on start. It is not part of
`db/migrations` and `makemigration` does not see it. If its shape ever
changes, a `flypath_jobs_version` row and an `alter` per version is the
whole upgrade story; the alternative — declaring it through
`flypath/schema` so the diff engine owns it — is a later refactor the
API does not depend on.

## Shape

```
src/jobs/
  schema.ts      the DDL and the six statements
  enqueue.ts     jobs(), cron(), options, the [fn, args] contract, keys
  registry.ts    id → fn and fn → id, populated by the virtual module
  worker.ts      work(): per-queue loops, LISTEN, sweep, retention, crons
  run.ts         the handler, timeouts, currentJob()
  config.ts      JobsOptions and defaults
src/vite/jobs.ts       the call-site rewrite (transform hook)
src/vite/jobs-scan.ts  call-site discovery → virtual:flypath/jobs
```

Touched: `index.server.ts` and `index.client.ts` (exports and stubs),
`runtime/server-entry.tsx` (imports the virtual module, exports `work`),
`cli.ts` (`work`, hooks in `dev` and `migrate`), `native/config.ts` and
`vite/index.ts` (the `jobs` option), `package.json` (`croner`).

## The API

### What is a job

Any `async function` exported from a module in the project that is not a
`"use server"` module. Nothing to import, nothing to wrap. It is called
with the arguments the enqueue site wrote, and its return value is stored
on the row as `output`.

Arguments are `jsonb`. Anything `JSON.stringify` loses — `Date`,
`bigint`, `Map`, class instances — is the caller's problem; the row stores
what JSON produced. Not enforced in the types (a `Json` constraint rejects
every interface without an index signature, which is all of them).

### Enqueueing

```ts
import { jobs } from "flypath";

const id = await jobs().enqueue(() => resize(post.id));
const ids = await jobs().enqueue(
  () => resize(1),
  () => resize(2),
);
await jobs({ queue: "images", delay: 30 }).enqueue(() => resize(post.id));
await jobs({ unique: true }).enqueue(cleanup);
await jobs().enqueue(async () =>
  (await import("./reports.ts")).digest("daily"),
);
```

`jobs(options?: EnqueueOptions)` returns `{ enqueue }`. `enqueue` takes
one or more thunks, each `() => Promise<unknown>` or `() => unknown`, and
returns `number | null` for one thunk and `(number | null)[]` for several;
`null` is "deduplicated". Several thunks are inserted in one statement.

`EnqueueOptions`, all optional, each overriding the queue's setting:
`queue`, `priority` (higher first), `unique`, `delay` (seconds), `at`
(`Date`), `retries`, `retryDelay`, `backoff`, `timeout` (seconds).

Inside `db.transaction()` the insert is part of the transaction and rolls
back with it, and the `NOTIFY` is delivered at commit. Both fall out of
`connection(name)`, not out of any option.

The types check the call inside the arrow against the function's own
signature, because it _is_ a call to the function as far as TypeScript is
concerned. What the types cannot express is "the callee must be a
project export"; the scan does.

### Configuration

```ts
// vite.config.ts
export default defineConfig({
  jobs: {
    queues: {
      default: { concurrency: 5 },
      images: {
        concurrency: 2,
        retries: 5,
        retryDelay: 30,
        backoff: true,
        timeout: 600,
      },
      bulk: { concurrency: 1, notify: false, pollInterval: 5 },
    },
  },
});
```

`JobsOptions`: `queues`, `database` (a named database, default
`"default"`), `retention` (seconds to keep `done` and `failed` rows,
default 7 days).

`QueueOptions`: `concurrency` (slots in this process, default 1),
`retries` (default 2), `retryDelay` (seconds, default 0), `backoff`
(exponential, default false), `timeout` (seconds a job may be active,
default 900), `notify` (LISTEN/NOTIFY wake-up, default true),
`pollInterval` (seconds, default 2). `default` always exists. An enqueue
naming an undeclared queue throws before touching the database.

There is no queue-level priority. Priority is on jobs; the lever that
makes one queue win is `concurrency`, and the lever that keeps a hot queue
from starving another is that each queue has its own fetch loop.

### Crons

```ts
// app/crons.ts
import { cron } from "flypath";

export default [
  cron("*/5 * * * *", () => refreshFeeds()),
  cron("0 3 * * *", () => prune(30), {
    timezone: "Europe/Lisbon",
    name: "nightly-prune",
  }),
];
```

`cron(expression, thunk, options?)` takes the same rewritten thunk and
produces `{ expression, thunk, key, options }`; the worker resolves the
thunk to `{ id, args }` at start. The key is `options.name` or
`"<job id>@<expression>#<args hash>"`. Five fields, minute resolution.
`EnqueueOptions` except `delay`/`at` apply.

### The worker

```
flypath work [--queues images,default] [--concurrency 4]
```

Loads `.env`, `vite.config.ts` for the queues, `dist/rsc/index.js` for the
code, installs the table if missing, and runs until `SIGTERM`/`SIGINT`,
at which point it stops claiming, waits for active jobs, and exits.
`--queues` limits which queues this process serves; `--concurrency`
overrides every queue's `concurrency`.

`flypath dev` starts the same loop in-process after `server.listen()`,
against every queue, through the RSC environment's module runner, and
stops it when the server closes. Nothing to install and nothing to run in
a second terminal.

### Inside a job

```ts
import { currentJob } from "flypath";

const { id, attempt, signal } = currentJob();
```

An `AsyncLocalStorage` like `context()`. `signal` aborts on timeout and on
shutdown. `db()`, `sql`, `db.transaction()` work; `cookies()`, `headers()`,
`context()` throw the request-only error they throw today.

## How it works

### The table

```sql
create table if not exists flypath_jobs (
  id           bigint generated always as identity primary key,
  queue        text not null,
  job          text not null,
  args         jsonb not null default '[]',
  key          text,
  priority     integer not null default 0,
  state        text not null default 'queued',
  run_at       timestamptz not null default now(),
  attempts     integer not null default 0,
  max_attempts integer not null,
  retry_delay  integer not null,
  backoff      boolean not null,
  timeout      integer not null,
  locked_at    timestamptz,
  locked_by    text,
  error        text,
  output       jsonb,
  cron_key     text,
  cron_at      timestamptz,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check (state in ('queued', 'active', 'retry', 'done', 'failed'))
);
create index if not exists flypath_jobs_claim
  on flypath_jobs (queue, priority desc, run_at, id) where state in ('queued', 'retry');
create unique index if not exists flypath_jobs_key
  on flypath_jobs (key) where state in ('queued', 'retry');
create unique index if not exists flypath_jobs_cron
  on flypath_jobs (cron_key, cron_at);
create index if not exists flypath_jobs_active
  on flypath_jobs (locked_at) where state = 'active';
create index if not exists flypath_jobs_finished
  on flypath_jobs (finished_at) where state in ('done', 'failed');
```

The retry policy is resolved at enqueue and stored on the row, so a
per-call override and a queue setting are the same thing by the time the
worker sees it, and changing `vite.config.ts` does not rewrite history.

### The six statements

**Claim** — one statement, the whole locking story:

```sql
update flypath_jobs set state = 'active', locked_at = now(), locked_by = $2, attempts = attempts + 1
where id = (
  select id from flypath_jobs
  where queue = $1 and state in ('queued', 'retry') and run_at <= now()
  order by priority desc, run_at, id
  limit 1 for update skip locked
)
returning *
```

**Enqueue** — one multi-row insert per `enqueue` call; `key` is null
unless `unique`, so the partial unique index only ever sees keys that
mean something:

```sql
insert into flypath_jobs (queue, job, args, key, priority, run_at, max_attempts, retry_delay, backoff, timeout)
select * from unnest($1::text[], $2::text[], $3::jsonb[], $4::text[], $5::int[], $6::timestamptz[], $7::int[], $8::int[], $9::bool[], $10::int[])
on conflict (key) where state in ('queued', 'retry') do nothing
returning id
```

followed, for each distinct queue with `notify` on whose `run_at` is now,
by `select pg_notify('flypath_jobs', $1)`. Inside a transaction Postgres
holds the notification until commit.

**Complete** and **fail** are fenced on `locked_by`, which is what makes
a late result from an expired attempt a no-op instead of a corruption:

```sql
update flypath_jobs set state = 'done', finished_at = now(), output = $2, locked_at = null, locked_by = null
where id = $1 and state = 'active' and locked_by = $3
```

```sql
update flypath_jobs set
  state = case when attempts >= max_attempts then 'failed' else 'retry' end,
  finished_at = case when attempts >= max_attempts then now() end,
  run_at = now() + make_interval(secs => case when backoff then retry_delay * power(2, attempts - 1) else retry_delay end),
  error = $2, locked_at = null, locked_by = null
where id = $1 and state = 'active' and locked_by = $3
```

**Sweep** — every worker, every 30 s, the same transition as fail
applied to whatever outlived its timeout, with `error = 'timeout'`:

```sql
update flypath_jobs set … where state = 'active' and locked_at + make_interval(secs => timeout) < now()
```

**Retention** — every worker, hourly:

```sql
delete from flypath_jobs where state in ('done', 'failed') and finished_at < now() - make_interval(secs => $1)
```

### Dedup

`unique` sets `key = sha1(id + canonical JSON of args)`. The partial
unique index makes a second insert with the same key conflict while the
first is `queued` or `retry`, and `do nothing … returning id` returns no
row for it, which `enqueue` reports as `null`. Once the first goes
`active` the key is free again: enqueueing during a run is allowed,
which is the semantics that does not lose an update made after the job
started.

### Retries, timeouts, crashes

`fail` computes the next state on the row itself: `retry` with
`run_at` pushed by `retryDelay × 2^(attempt−1)` when `backoff`, plain
`retryDelay` otherwise, or `failed` after `max_attempts`. Delayed retries
are found by the poll, not by a notification.

`timeout` is the row's own column. The handler races the job against a
local timer and aborts `currentJob().signal` at the deadline; the attempt
is then failed through the normal statement, so the retry is immediate
rather than waiting for the sweep. The body cannot be killed: a job that
ignores the signal keeps running while its retry may already be
executing elsewhere, and whichever finishes second finds `locked_by` no
longer matches and writes nothing. That is the guarantee every SKIP
LOCKED queue without process isolation gives, and the plan states it
rather than hiding it.

A worker that dies mid-job leaves an `active` row with a stale
`locked_at`; the next sweep by any worker returns it to `retry`.
Detection latency is the job's `timeout`; a queue that needs faster
detection sets a shorter one.

### The worker loop

`work({ queues, concurrency })` in `worker.ts`:

- installs the table (idempotent DDL under the migration lock),
- opens `pool(name).listen("flypath_jobs", wake)` once per process; the
  payload is the queue name and `wake` resolves that queue's sleeper,
- starts one loop per queue: while a slot is free, claim; a claimed row
  runs in a slot and on settle the loop claims again; when a claim
  returns nothing the loop sleeps until `wake` or `pollInterval`,
  whichever first,
- starts the sweep, retention and cron tickers,
- on `SIGTERM`/`SIGINT`: stop claiming, abort every `signal` after a
  grace period, wait for slots to drain, `unlisten`, return.

The worker id is `<hostname>:<pid>:<random>`.

`notify: false` on a queue skips the `pg_notify` at enqueue and makes
that loop poll-only; this is the DBOS lever. Bulk `enqueue` is one
statement and one notification per queue regardless.

### Crons

At worker start, `crons` is imported from the registry module and each
thunk resolved to `{ id, args }` through the same contract as `enqueue`;
`croner` parses every expression and timezone then, so `flypath dev`
reports a bad one at start.

The ticker sleeps to the next local minute plus a little jitter, then
asks the database for `date_trunc('minute', now())` — the database clock
is the one clock, so two workers with skewed clocks agree on `cron_at`.
For every entry whose `nextRun` from the previous minute is at or before
that minute, it inserts a row with `cron_key` and `cron_at`; the unique
index collapses the concurrent inserts from every worker to one, and
`do nothing` keeps the losers quiet. A minute nobody was running for is
not backfilled.

### The rewrite

`vite/jobs.ts` is a transform hook on the rsc environment, prefiltered by
`code.includes(".enqueue(") || code.includes("cron(")`. It parses with
`oxc-parser`, walks to call expressions whose callee is `<expr>.enqueue`
where `<expr>` is a call to the `jobs` binding imported from `"flypath"`
(or a top-level `const` bound to one in the same file), or the `cron`
binding imported from `"flypath"`, and rewrites each argument with
`magic-string`:

| written                                               | emitted                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `() => resize(a, b)`                                  | `() => [resize, [a, b]]`                               |
| `() => ns.resize(a)`                                  | `() => [ns.resize, [a]]`                               |
| `async () => (await import("./r.ts")).digest("d")`    | `async () => [(await import("./r.ts")).digest, ["d"]]` |
| `cleanup`                                             | unchanged                                              |
| `() => { … }`, `() => a(b(c))`, `() => x ? a() : b()` | build error                                            |

Argument expressions are copied verbatim, so captured variables, spreads
and defaults evaluate at enqueue time exactly as they would have. The
callee expression is copied verbatim too, which is why the transform
needs no resolution. A bare reference is left alone: `enqueue(cleanup)`
means "call `cleanup` with no arguments".

An arrow whose body is `a(b(c))` is rejected because the inner call would
run at enqueue time; the message says to enqueue `a` with the result of
`b` computed first.

### The contract at runtime

`enqueue` awaits each thunk. The value is either `[fn, args]` from a
rewritten arrow or a function from a bare reference, normalised to
`[fn, []]`. `registry.idOf(fn)` gives the id; a miss throws
"`<name>` is not a job: it must be an export of a module the scan can see,
called from an arrow literal", which is also what a thunk held in a
variable produces, since the rewrite only sees literals.

### The registry

`registry.ts` holds `singleton("jobs", () => ({ byId: new Map(), byFn: new WeakMap() }))`.
`virtual:flypath/jobs` is

```js
import * as m0 from "/abs/app/images.ts";
import * as m1 from "/abs/app/maintenance.ts";
import { register } from "<dist>/jobs/registry.js";
register({
  "app/images.ts#resize": m0.resize,
  "app/maintenance.ts#prune": m1.prune,
});
export { default as crons } from "/abs/app/crons.ts";
```

`server-entry.tsx` imports the module first, as it does
`virtual:flypath/database`, so both maps exist before any request or
worker claim. In dev, editing `images.ts` invalidates it, the virtual
module that imports it, and the entry, so the next `runner.import`
re-registers the new function object under the same id; the worker reads
`byId` per claim and never holds a stale reference. `crons` is `[]` when
`app/crons.ts` does not exist.

### The scan

`vite/jobs-scan.ts` walks the project (`app/` and any other directory
under root except `node_modules`, `dist`, `android`, `apple`, `cpp`),
skips files whose text has neither `.enqueue(` nor `cron(`, parses the
rest, and for each call site takes the callee of the arrow body:

- an identifier bound by `import { x } from "./m.ts"` or
  `import { y as x }` → resolve `"./m.ts"` from the importer with
  `this.resolve`, id `<relative path>#y`;
- a member `ns.x` where `ns` is `import * as ns from "./m.ts"` → same;
- `(await import("./m.ts")).x` → same;
- an identifier declared at the top level of the same file → must be
  exported, id `<this file>#x`;
- anything else → error with location.

The target file is read once to check for a `"use server"` directive and
to confirm the export exists. The plugin registers every scanned file and
the target files with `addWatchFile`, and invalidates the virtual module
on add, unlink and change of any of them. Same skeleton as `routes()`.

### The handler

`run.ts` takes a claimed row, looks the id up in `byId`, fails the row
without retry when it is unknown (`attempts` forced to `max_attempts`),
otherwise runs `fn(...args)` inside `currentJob` storage with a signal
composed from the timeout timer and the shutdown controller, and writes
`complete` or `fail` with the worker id as the fence.

## Tests

`test/jobs/`, Postgres ones gated on `TEST_DATABASE_URL` like
`test/db/client.test.ts`, each file in its own random schema via
`searchPath` so the table installs fresh and drops on `afterAll`.

- **schema** — install is idempotent and two concurrent installs
  succeed; every statement compiles against the table.
- **statements** — claim returns the highest priority then the oldest
  `run_at`, skips a future `run_at`, and two concurrent claims in open
  transactions get different rows; complete and fail with a wrong
  `locked_by` change nothing; fail computes `retry` with and without
  backoff and `failed` at the limit; sweep returns a stale `active` row
  and leaves a fresh one; retention deletes only finished rows past the
  window.
- **rewrite** — each row of the table above produces the expected code
  and nothing else in the file moves; `jobs` imported under another name;
  a `.enqueue(` on an unrelated object is untouched; the rejected shapes
  report the right line; source map covers the rewritten span.
- **contract** — a rewritten sync thunk, an async thunk with a dynamic
  import, a bare reference, captured variables and spreads evaluate at
  enqueue time; an unregistered function throws the "not a job" message.
- **scan** — every callee form resolves to the expected id; the same
  function from two sites registers once; a same-module unexported
  target, a parameter, a method and a `node_modules` import each error
  with a location; a `"use server"` target errors; the crons re-export
  is present and defaults to `[]`.
- **enqueue** — options layer call over queue over default onto the
  row; bulk inserts several queues in one statement; an undeclared
  queue throws before any SQL; an enqueue inside `db.transaction()` that
  throws leaves no row and sends no notification.
- **dedup** — same unique call twice → one row, second returns `null`;
  distinct args → two rows; enqueue again after the first is claimed
  succeeds; a non-unique job enqueued twice → two rows.
- **worker** — enqueue then work runs the function with the right args
  and stores the return value; fifty jobs and two `work()` instances
  complete each exactly once; a notify-queue job runs within 500 ms with
  `pollInterval` at 30 s; `notify: false` waits for the poll; a delayed
  job runs after `delay`; shutdown drains an active job before
  returning.
- **retries** — a job that throws N−1 times succeeds on attempt N with
  `currentJob().attempt` counting; one that always throws ends `failed`
  after `retries` with `error` set.
- **timeout** — a job that awaits `signal` sees it abort at `timeout`
  and the row goes to `retry`; a job that ignores the signal and
  resolves after the retry has been claimed elsewhere writes nothing;
  an unknown id fails without retry.
- **crons** — two tickers given the same minute insert one row; a
  changed expression changes the key; an invalid expression or timezone
  throws at start; a timezone entry fires at the local hour across a
  DST boundary.
- **types** (`.test-d.ts`) — arguments inside the arrow are checked
  against the function's signature; `enqueue(resize)` is an error when
  `resize` has required parameters; `enqueue` returns `number | null`
  for one thunk and an array for several.

## Phases

### Phase 0 — the table

`jobs/schema.ts` with the DDL and the six statements as `sql` fragments,
`jobs/config.ts`, the `jobs` option through `native/config.ts` and
`vite/index.ts`, and `flypath migrate` installing the table. Schema and
statement tests, including the two-transaction claim test that proves
SKIP LOCKED does what the brief requires.

### Phase 1 — enqueue

`jobs().enqueue()` over the `[fn, args]` contract, option layering, keys,
dedup, `registry.ts` populated by hand in tests. Client-barrel stubs.
Enqueue, dedup, contract and type tests.

### Phase 2 — the rewrite and the scan

`vite/jobs.ts`, `vite/jobs-scan.ts`, `virtual:flypath/jobs`, the import
in `server-entry.tsx`, watching and invalidation, every error message.
Rewrite and scan tests.

### Phase 3 — the worker

`work()` exported from the server entry, the loops, LISTEN, sweep,
retention, `run.ts` with `currentJob()` and timeouts, graceful stop,
`flypath work`, the in-process start in `flypath dev`. Worker, retry and
timeout tests.

### Phase 4 — crons

`cron()`, `app/crons.ts`, `croner`, the ticker. Cron tests.

### Phase 5 — the example earns it

`notifyMentions` in a new `example/app/jobs.ts` (not `actions.ts`),
enqueued from `postNote` in its transaction, an `images` queue in
`example/vite.config.ts`, a nightly cron, and the milestone walked
through on web and native.

## Key decisions

- **Custom over pg-boss.** Six statements on the pool we already have,
  one 164 KB dependency, no second driver, no external schema; the
  library would have saved ~300 lines and cost 23 packages and its
  adapter as the top risk.
- **SKIP LOCKED to claim, a sweep for the dead.** One mechanism; the
  timeout the brief asks for is the same column the sweep reads.
- **Policy on the row.** Retries, delay, backoff and timeout are
  resolved at enqueue; the worker never consults config for a row.
- **`locked_by` is the fence.** Late writes from expired attempts are
  no-ops by construction.
- **No wrapper.** A job is an exported async function. The framework's
  need to know which one is met by a forty-line syntactic rewrite at the
  call site and a reverse map, not by asking the user to mark things.
- **The rewrite resolves nothing; the scan resolves everything.** One
  place does import resolution, at build time, with `this.resolve`, and
  it is the same place that must exist anyway to tell a production
  worker which modules to load.
- **Ids are path plus export name.** A rename is a new id, and the old
  rows fail loudly.
- **`"use server"` modules cannot hold jobs.** A build error, because the
  alternative is an exported job doubling as a public endpoint.
- **Cron dedup is a unique index on the database's minute.** No leader,
  no clock sync, no schedule table.
- **Crons in `app/crons.ts`, queues in `vite.config.ts`.** Code where the
  module graph is, configuration where `databases` already is.
- **The table is framework-owned and ad hoc.** Installed like
  `flypath_migrations`; not diffed by `makemigration`.

## Not in this plan

- Per-function defaults (`queue`, `retries`) attached to the definition.
  There is no definition-site marker to hang them on; the call site and
  the queue carry them.
- A `flypath jobs` CLI to list, retry or discard `failed` rows. The
  table is plain and `sql` reaches it; a command can come later.
- Job results and awaiting a job from the enqueuer.
- Dead-letter queues, heartbeats, workflows, pub/sub.
- Backfilling cron minutes that passed while no worker ran.
- Isolating a job in a thread or process for hard kills.
- A `Json` constraint on arguments, or non-JSON serialisation.
- Typed queue names via `Register`.
- Notification batching à la DBOS.
- Declaring `flypath_jobs` through `flypath/schema` so the diff engine
  owns it.

## Risks / open questions

- **Enqueue sites the rewrite cannot see.** A thunk built elsewhere and
  passed in, or `enqueue` reached through an alias the transform does
  not recognise, fails at runtime with the "not a job" message rather
  than silently running the arrow. The accepted aliases are listed
  above; anything else is loud.
- **A callee that is both a job and a plain call.** Nothing stops
  `await resize(1)` inline elsewhere; that is a feature. But a function
  that closes over request context behaves differently in a worker.
  Documented, not detected.
- **Claim throughput.** `update … where id = (select … skip locked)` is
  one round trip per claim per slot. Fine to thousands of jobs a second
  with the `flypath_jobs_claim` index; batching claims (`limit n`) is
  the first optimisation if a queue ever measures otherwise.
- **`retry` rows and the unique key.** A `unique` job stuck in `retry`
  blocks re-enqueue until it succeeds or fails. That is intended — the
  call is still pending — but it means a bad job with a long backoff
  holds its key. `failed` releases it.
- **Sweep and long jobs.** The sweep trusts `timeout`; a legitimately
  long job with a short timeout is retried while still running and both
  run to completion. The fence makes it harmless to the table, not to
  the side effects. Set `timeout` above the worst case.
- **The rsc runner in `flypath dev`.** `server.environments.rsc` is a
  runnable environment (plugin-rsc asserts it), but `runner.import` of
  the server entry from the CLI while plugin-rsc also imports it must
  yield the same module instance; the registry being a `singleton()`
  makes this a non-issue even if it does not.
- **Schema evolution.** The table has no version row today. The first
  time it needs one, add it; until then `create … if not exists` is
  the whole install.
