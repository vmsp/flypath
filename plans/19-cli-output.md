# Flypath — CLI output

## Goal

Every command prints what the person running it needs and nothing else:
what is happening now, what finished, what went wrong and what to do
about it. Output from the tools flypath orchestrates — Vite, xcodebuild,
Gradle, React Native's scripts — is hidden unless it is an error, or a
warning in code the project owns. All commands share one visual
language.

Milestone: a warm `flypath ios` prints five lines and exits.
`flypath build` prints one line per step and no file list. `flypath dev`
prints a header, then one line per route rendered, action run, job run,
file changed and device log. No line anywhere starts with `flypath:`.
`--verbose` brings everything back.

## What is wrong today

Measured on `example/` at `5c8abbc`.

1. **`flypath ios` prints 5,648 lines for a successful simulator build.**
   - 57 lines from `setup-apple-spm`: codegen chatter, "SPM setup
     complete!", "Open App.xcodeproj in Xcode (or `npm run ios`)", "To
     remove SPM later: `npx react-native spm deinit`" — instructions for
     a different tool.
   - 2,728 `export NAME=value` lines: xcodebuild echoes the whole build
     environment for the scheme pre-action "Sync SPM Autolinking".
   - 202 `warning:` lines, 93 distinct, **zero** in `example/apple` or
     `example/cpp`. React's umbrella headers, nullability notes,
     `appintentsmetadataprocessor`, and the pre-action having no outputs.
   - After `** BUILD SUCCEEDED **`, `simctl launch --console-pty`
     attaches to the app and never returns:
     `_setUpFeatureFlags called with release level 2`,
     `[RCTMultipartDataTask] GET …`,
     `WARNING: Logging before InitGoogleLogging()`,
     `W0910 … ReactInstance.cpp:287]`. The JS console already reaches
     the dev server, so this stream is duplicates plus native internals.

   The cause is one line: `run()` defaults to `stdio: "inherit"`
   (`native/exec.ts:18`), so every tool the command drives writes
   straight to the terminal.

2. **`flypath build` prints the file list of three environments.** 69
   lines for the example, 42 of them
   `dist/…/assets/x-Hash.js 0.33 kB │ gzip: 0.24 kB` rows nobody reads.
   Around them: "vite v8.2.2 building … for production" five times,
   plugin-rsc's `[1/5] analyze client references...` steps (two of the
   five builds are analysis passes that write nothing), and Vite's TTY
   progress (`transforming (140) …`, `rendering chunks (17)...`) run
   together on single lines.

3. **`flypath dev` prints Vite's log, and nothing about the app.**
   Timestamps, `[vite]`, environment tags; `(rsc) connected.` at start
   and `(ssr) connected. (x2)` on the first document;
   `Re-optimizing dependencies because vite config has changed` once per
   environment with a screen clear between each; and a warning that
   react-devtools-core's `backend.js` sourcemap "points to missing
   source files".
   Five page requests and an action produced no lines except the failing
   action, which printed Vite's `Internal server error:` and four undici
   frames. Device logs arrive as
   `[native:log] flypath: fetching / for entry-3 at epoch 0 with chrome #0, #1`
   — framework tracing (`runtime/native-content.ts:112`) that is on
   whenever the bridge is in dev.

4. **The prefix.** 303 string literals in `src/` begin with `flypath: `
   (vite 68, native 54, serve 46, runtime 32, styles 17, router 17,
   migrations 17, cli 17, …). In a terminal that only ever runs flypath
   it says nothing, and it forces the sentence shape every message has
   today: lowercase, one long line, "what happened — what to do".

5. **No shared vocabulary.** Each site picks `console.log`, `warn` or
   `error`; `bundle.ts` and `acme.ts` take `log` callbacks that default
   to `console.log`; Vite plugins use `config.logger`; the prerender
   step logs through `builder.config.logger.info`. `fail()`
   (`cli.ts:175`) prints `error.message` for every error, so an
   unexpected `TypeError` loses its stack while an expected "no
   simulator is available" reads like a crash.

6. **Smaller.**
   - `flypath start` with a cluster prints `flypath: 4 workers` and then
     `flypath: listening on …` once per worker — `serveProcess` runs in
     every worker (`serve/index.ts:360`).
   - `migrate --status` prints `up      x` / `pending x` / `NO FILE x`.
   - `--help` is cac's default, including nine lines of "run any command
     with the `--help` flag".
   - `flypath ios` on a device repeats the local-network permission
     reminder on every run.

## Field notes — prior art

**Next.js.** One mark per kind of line (`✓` done, `○` in progress, `⚠`
warning, `⨯` error), a header with the version and URLs,
`✓ Ready in 1.3s`, then one line per request with status and time.
`next build` shows each phase as a spinner that resolves into a `✓` line
— "Compiled successfully", "Collecting page data", "Generating static
pages (5/5)" — and ends with a route table. Worth taking: header once,
request lines, phases as lines, the build confirming what was
prerendered. Worth leaving: the per-route JS size column (a module graph
walk for a number that is rarely acted on), and a design that assumes
one runtime. Flypath has three platforms reporting into one terminal, so
platform is a column Next never needed.

**Vite.** Its defaults suit a bundler that shares a terminal with other
tools, which is why every line carries a timestamp and a `[vite]` tag.
The escape hatches are what matter here. `customLogger` receives every
message unfiltered — `createLogger` returns it verbatim
(`vite/dist/node/chunks/node.js:3234`) — and the build reporter only
prints when `logLevel` is `"info"` (`:3319`). So `logLevel: "warn"` plus
a `customLogger` silences the file list and the progress lines while
every other message still reaches flypath.

**Expo CLI, `expo run:ios`.** The same problem, already solved:
xcodebuild's output goes through a formatter that prints one line per
meaningful step, hides most warnings that come from dependencies, shows
errors with their file and line, and writes the full log to disk,
naming it in the failure message. It does not attach to the app's
native console; device logs come through Metro. Worth taking: filtering
by who owns the file, the full log on disk, device logs through the dev
server. Worth leaving: a line per compiled file, which is still dozens
of lines on a warm build.

**Cargo.** Progress on stderr, results on stdout; `Compiling x`,
`Finished … in 1.2s`; warnings counted at the end. Worth taking: the
stream split, so the output of a command that produces data can be
piped.

## Options considered

### A library, or not

What flypath needs: color that respects `NO_COLOR`, `FORCE_COLOR` and
non-TTY streams; one live line (spinner, label, elapsed time) that other
writes can print above; aligned columns; a yes/no prompt.

- **Color.** `util.styleText` ships with Node. From 22.13 it takes a
  `stream` and checks it, so color switches itself off for pipes and
  `NO_COLOR`. The package already requires Node 24. picocolors, which
  Vite uses, would also work; `styleText` does the same with no
  dependency.
- **The live line.** ora, yocto-spinner and nanospinner all draw the
  frames, which is the easy part. The hard part is that while a line is
  live, Vite's logger, user code (a prerendered page's `console.log`)
  and the subprocess parsers are all writing too. Whoever owns the live
  line has to clear it before any write and redraw it after, which
  means wrapping `process.stdout.write` and `process.stderr.write` for
  the life of the step. A library that owns its own stream does not
  know about the other writers. In-house, this is about 80 lines.
- **listr2, @clack/prompts.** Complete renderers with a strong look of
  their own (clack's `│ ◇` gutter is recognisable at a glance). Using
  one means taking its look, which is the opposite of the brief.
- **Prompts.** `readline.question` stays (`migrations/generate.ts:20`);
  only its prefix changes.

Taken: **no dependency.**

### stdout or stderr

Human-facing output — header, steps, warnings, errors, request lines —
goes to **stderr**. **stdout** carries data only: `migrate --sql` and
`--plan`, and `flypath start`'s access log, which is the service's
output and what a log collector reads. `flypath migrate --sql > up.sql`
then produces a file of SQL, and `flypath start > access.log` keeps only
access lines. Commands that print data print no header.

### Quieting xcodebuild

- `-quiet` prints warnings and errors only. All 202 warnings stay, and
  nothing is left to drive a progress label.
- xcbeautify or xcpretty: an external binary that is not installed by
  default, and still one line per file.
- **Capture and classify.** Everything goes to a log file; each line is
  read as it arrives for a progress label and for diagnostics that name
  a file. The classifier is small because the question it answers is
  small: _is this an error, or a warning in a file the project owns?_

Taken: capture and classify. The same applies to Gradle,
`setup-apple-spm`, `keytool`, `adb` and `simctl`.

### Stay attached to the app, or exit

Today `flypath ios` ends in `simctl launch --console-pty` and never
returns. Proposed: **launch and exit.** JS console output already reaches
the dev server (`HotSocket`, `vite/metro-sockets.ts:96`). The native
console is React Native and glog internals. An attached process looks
exactly like a hung one. And a command that exits can be re-run without
Ctrl-C. `--console` keeps today's behaviour for the cases that need it:
a Swift `print` in a native module, or a native crash.

### Where request lines come from

A Vite middleware sees every request and knows nothing about them. It
would need a denylist — `/@vite`, `/@fs`, `/node_modules`, `*.bundle`,
`/symbolicate`, `/json`, `/status`, the inspector — and it still could not
name the route, the platform or the action. The handler in
`runtime/server-entry.tsx` knows all of them: the platform (`:233`),
flight or document (`:243`), the matched route, the decoded action
(`:143`), a redirect (`:380`) and the final status. **The handler emits
an event and the terminal formats it.** Only what the framework rendered
is ever reported, so no denylist is needed.

The catch: in dev, the handler runs inside Vite's module runner, which
has its own module graph. A module-level singleton in the CLI is not the
same object the handler sees. `shared/globals.ts` already solves this —
`__FLYPATH_STATE__` carries `requestStorage` and the pools across that
boundary — so the sink lives there as `report?: (event: Event) => void`.
When it is unset, reporting does nothing (tests, and any host that did
not ask for it).

`flypath start` keeps its own outer access log (`serve/index.ts:133`),
because it sees static files and aborted requests that the handler
never does. It switches to the same line formatter. Route and action
names are a dev aid; production lines stay method, path, status,
platform and time.

### The prefix

Drop all 303. A message becomes a headline in sentence case (what
happened) and an optional hint (what to do). Messages that surface in a
browser or on a device lose the prefix too: they name flypath APIs
(`headers().set("x") changes nothing…`), which identifies them well
enough.

## The visual language

Every line is indented two spaces. There is a blank line after the
header and before any summary.

| Mark | Color  | Meaning                                      |
| ---- | ------ | -------------------------------------------- |
| `✓`  | green  | a step finished                              |
| `⠋`  | accent | a step is running (braille frames, TTY only) |
| `!`  | yellow | warning                                      |
| `✗`  | red    | error                                        |
| `↻`  | dim    | a file changed, a reload, a restart          |

- **One accent color**, for the name in the header, URLs and the spinner.
  Green, yellow and red appear only on marks and HTTP statuses.
  Everything secondary — durations, platforms, sizes, hints, directory
  parts of paths — is dim. Body text is the terminal's default color.
- **Numbers.** `38ms`, `1.4s`, `1m 12s`. `812 kB`. Counts are
  pluralised. Paths are relative to the project root, never absolute.
- **Non-TTY and CI.** No spinner and no cursor movement: a step prints
  only its settled line, and color is off unless `FORCE_COLOR` is set.
  `TERM=dumb` swaps the marks for ASCII.

## Shape

```
src/terminal/
  style.ts        marks, styleText bound to a stream, durations, sizes, plurals
  output.ts       header, step, warn, error, rows; owns the live line
  logger.ts       a Vite Logger that routes into output.ts
  format.ts       Event → line (request, action, job, device, change)
src/shared/
  events.ts       the Event type and report(event), which reads globals().report
  errors.ts       FlypathError
src/native/
  exec.ts         run(): captures by default, streams lines, tees to a log file
  diagnostics.ts  xcodebuild and Gradle lines → progress label | diagnostic
```

`runtime/` and `jobs/` import only `shared/events.ts`, which has no Node
imports beyond the globals they already use. `terminal/` is Node-only
and never reaches a client or native bundle.

## The API

```ts
export function header(command: string, rows?: Row[]): void;

export function step<T>(
  label: string,
  run: (progress: Progress) => Promise<T>,
): Promise<T>;

export type Progress = {
  status(text: string): void;
  summary(text: string): void;
};

export function warn(message: string, hint?: string): void;
export function fail(error: unknown): never;
export function rows(entries: Row[]): void;
export function verbose(): boolean;
```

`step` on a TTY draws `⠋ label  status  0:12` and settles into
`✓ label summary  12.4s`, or into `✗ label` and rethrows. Off a TTY it
prints nothing until it settles. While a step is live, every write —
`warn`, the Vite logger, a foreign `console.log` — clears the line first
and redraws it after.

```ts
export class FlypathError extends Error {
  constructor(
    message: string,
    options?: { hint?: string; details?: string[]; cause?: unknown },
  );
}
```

`fail()` prints a `FlypathError` as `✗ message`, then the hint and the
details dim and indented, with no stack — it is an expected failure. Any
other error prints `✗ Name: message` and a stack with `node:internal`
and `node_modules` frames removed and paths made relative. `--verbose`
prints full stacks for both. `run()` throws a
`CommandError extends FlypathError` that carries the command, the log
path and the diagnostics it collected.

## Per command

### `flypath ios` and `flypath android`

```

  flypath 0.0.0  ios

  ✓ Generated the Xcode project     1.9s
  ✓ Built for iPhone 17 Pro        52.1s
  ✓ Launched on iPhone 17 Pro

```

While building:

```
  ⠼ Building for iPhone 17 Pro     Compiling FlypathRuntime.cpp  0:41
```

A warning in the project's own code, printed after the step settles:

```
  ✓ Built for iPhone 17 Pro        52.1s
  ! apple/Sources/Camera.swift:42:9
    'devices' was deprecated in iOS 17.0
```

A failure:

```
  ✗ Build failed for iPhone 17 Pro

    apple/Sources/Camera.swift:42:17
    cannot find 'AVCaptureSesion' in scope

    Full log  node_modules/.flypath/logs/ios.log
```

No dev server. After the build and before the launch, flypath probes
`/status`, which the dev server already answers with
`packager-status:running` (`vite/metro-endpoints.ts`):

```
  ! Nothing is listening on http://localhost:8081
    The app shows a red screen until flypath dev is running
```

On a device, the launch line carries the address the app will use
(`reaching http://192.168.1.65:8081`). The local-network permission
hint prints on the first launch per device id only, remembered in
`node_modules/.flypath`.

**Classifying lines** (`native/diagnostics.ts`):

- **Progress label, xcodebuild.** `Resolve Package Graph` → "Resolving
  packages"; `CompileC` / `SwiftCompile` / `CompileSwift` → "Compiling
  <basename>"; `Ld` → "Linking"; `CodeSign` → "Signing". Any other line
  leaves the label unchanged.
- **Progress label, Gradle** (run with `--console=plain` so it draws no
  bar of its own). `> Task :app:<name>`: `compile*Kotlin` → "Compiling
  Kotlin", `buildCMake*` / `externalNativeBuild*` → "Compiling C++",
  `dexBuilder*` / `mergeDex*` → "Dexing", `package*` → "Packaging",
  `install*` → "Installing".
- **Diagnostics.** Clang and Swift's
  `file:line:col: error|warning: text`; Kotlin's `e:` /
  `w: file://path:line:col text`. Swift prints each diagnostic twice —
  once boxed (`` `- warning: ``), once in the plain form — so only the
  plain form is matched, then deduplicated on file, position and text.
- **Ownership.** A diagnostic belongs to the project when its real path
  is under the root and not under `node_modules`. Errors are shown
  whoever owns them. Warnings are shown only when the project owns them.
- **File-less errors.** A line starting `error:` — signing, provisioning,
  "No profiles for … were found" — is always shown.
- **Fallback.** A failure with no diagnostics prints xcodebuild's "The
  following build commands failed:" block, or Gradle's
  `* What went wrong:` up to `* Try:`, or the last 20 lines of the log.

**The log file** is `node_modules/.flypath/logs/<command>.log`,
overwritten on each run, with a `$ command args` line before each
subprocess's output. It sits outside the generated `ios/` and `android/`
directories because `prepareIos` and `prepareAndroid` delete those
(`ios.ts:130`, `android.ts:201`).

**Release builds** (`--release`) become steps too. They end on the
artifact and its size, `✓ Wrote dist/app-release.aab  24.1 MB`, and a
dim next-step hint (Play Console, `adb install`, `-exportArchive`) in
place of today's multi-line blocks.

### `flypath build`

```

  flypath 0.0.0  build

  ✓ Analyzed references      0.2s
  ✓ Built server             0.2s   149 modules
  ✓ Built client             0.1s   77 modules · 231 kB JS
  ✓ Built SSR                0.1s   78 modules
  ✓ Prerendered 1 page       0.1s
  ✓ Bundled iOS              3.4s   Hermes · 812 kB · 14 chunks

  ✓ Built in 4.3s  dist/

```

- The CLI passes `customLogger` and `logLevel: "warn"` to
  `createBuilder`. The reporter goes quiet, and the logger drops
  plugin-rsc's `logStep` lines and Vite's "building for production"
  lines.
- A `flypath:progress` plugin (`sharedDuringBuild: true`) opens a step in
  `buildStart` and settles it in `closeBundle`. The label comes from
  `this.environment.name` and `this.environment.config.build.write`:
  plugin-rsc sets `write = false` for its two analysis passes
  (`plugin-rsc/dist/plugin-*.js`, just before `logStep("[1/5] …")`), so
  both collapse into one "Analyzed references" step. It opens on the
  first `write: false` build and settles on the first `write: true`. A
  `transform` counter per environment feeds the live status ("412
  modules").
- `vite/prerender.ts` wraps its loop in a step. Today's one line per
  page, `flypath: prerendered /about → …`, becomes the step's status:
  `Prerendering 3/12 /about`.
- `buildNativeRelease` loses its `log` callback. Each platform is one
  step whose summary carries the three facts it logs today. "hermesc was
  not found; shipping the source bundle" becomes a warning, because a
  release shipping source instead of bytecode is one.
- Rolldown warnings (through `logger.warn`) are collected during the
  steps and printed after the last one with a count. Warnings about
  files under `node_modules` are counted but not listed:
  `3 more from dependencies — --verbose to list them`.

Optional, and last: a route summary between the steps and the final
line, listing each pattern with a dim `prerendered` tag where it
applies. It is the only place the build confirms what `prerender: true`
did. No legend, no sizes.

### `flypath dev`

```

  flypath 0.0.0  dev

  Local     http://localhost:8081
  Network   http://192.168.1.65:8081
  Database  2 migrations pending — run flypath migrate

  ✓ Ready in 612ms

  GET  /                  200  web   41ms
  GET  /about             200  web    6ms  prerendered
  GET  /feed              200  ios   23ms
  POST /post/12  like()   303  ios   18ms  → /post/12
  ↻ app/feed.tsx
  ios  fetching feed
  ios  ! Each child in a list should have a unique "key" prop
  job  sendWelcome        done       120ms
  POST /login  login()    500  web    4ms
  ✗ TypeError: Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded"
      at app/login.tsx:14:22

```

**Shown:** the header; `Ready`; one line per request the handler
rendered and per action it ran (the action's export name, taken from the
server reference id after `#`); job runs, since dev runs the worker
in-process (`cli.ts:196`); device logs, tagged with the platform and
colored by level; one `↻` line per saved file;
`↻ Restarted — vite.config.ts changed`; errors; warnings from the
project and from flypath. The `Database` row appears only when something
needs doing.

**Hidden** unless `--verbose`: Vite's info messages (`connected.`,
`Re-optimizing dependencies…`, `hmr update`, `page reload`,
`server restarted.`); warnings about files under `node_modules`, such as
the react-devtools-core sourcemap; React Native dev-middleware info;
framework tracing on the device; and prefetch requests (`isPrefetch()`),
which would add a line per link on a page.

**How:**

- `cli.ts` passes `customLogger` and `clearScreen: false` to
  `createServer`, and prints the header from `server.resolvedUrls`
  instead of calling `printUrls()`.
- **File changes.** The flypath plugin's `hotUpdate` hook runs once per
  environment — rsc, ssr, client and both native environments all see
  the same save. It collects `file` and flushes after 25ms, so each
  saved file gets one line.
- **Requests, actions and jobs.** The handler and `jobs/run.ts` (around
  `complete`, `fail` and `discard`) call `report()`. The plugin's
  `configureServer` installs the sink, so a bare `vite dev` gets the
  same lines as `flypath dev`. If the handler throws, it reports a 500
  before rethrowing. The time is measured to the end of the response
  stream, so a slow `<Suspense>` boundary shows up in the number.
- **Device logs.** `HotSocket` reports
  `{ kind: "device", platform, level, text }` instead of calling
  `logger.info` with `[native:log]`. It has to learn the platform when
  the socket connects.
- **Framework tracing.** `native-content.ts`'s `log()` is gated on a
  `debug` flag next to `dev`, set by the dev server from `--verbose`.
- **Errors.** Vite's error middleware calls
  `logger.error(msg, { error })`, so the logger gets the `Error` itself
  and prints the `✗` block from it, with the stack already remapped by
  `ssrFixStacktrace`.

### `flypath start`

```

  flypath 0.0.0  start

  Local    http://localhost:3000
  Workers  4

  ✓ Ready in 180ms

```

Access lines follow on stdout in the dev format, without route or
action names, and without color when piped. Only the primary prints the
header and `Ready`. Workers send `{ type: "ready" }` over the existing
`ServeMessage` channel and otherwise stay silent. A worker restart is a
warning. Shutdown prints `↻ Draining 3 requests`. The `"combined"`
access log format is untouched: it is a standard.

### `flypath work`

```

  flypath 0.0.0  work

  Queues  default ×5 · notifications ×2 · maintenance ×1
  Crons   2

  ✓ Ready

  job  sendWelcome        done       120ms
  job  sendDigest         retry 2/5  in 10s   SMTP timeout

```

The same `job` lines as dev, from the same events.

### Migrations

```
  ✓ Applied 20260908220000_user_email
```

`--status`:

```

  Migrations  default

  ✓ 20260904161647_initial
  ✓ 20260904161654_add_users_bio
  ○ 20260908220000_user_email          pending
  ✗ 20260101000000_gone                applied, file missing

```

`--sql` and `--plan` print to stdout: no header, no color.
`makemigration --check` fails as
`✗ db/schema.ts has 2 changes with no migration` with the hint "run
flypath makemigration". Prompts gain an accent `?` prefix.

### `--help`

cac's `cli.help(sections => …)` callback can rewrite the sections: an
`flypath 0.0.0` header, commands grouped (Develop: dev, ios, android ·
Ship: build, start, work · Database: makemigration, migrate, rollback),
and the nine "for more info" lines replaced by one.

### Verbosity

`--verbose` is a global cac option, and `FLYPATH_VERBOSE=1` is added to
`ENV` in `shared/env.ts`. The variable means `pnpm dev` works without
editing scripts, and it is how the dev server hands the flag to runtime
code. Verbose restores today's behaviour: subprocess output inherited
(still teed to the log file), every Vite message verbatim, device
tracing on, full stacks. There is no `--quiet`: the default is already
quiet, and CI gets the non-TTY rendering on its own.

## What changes

**New**

- `src/terminal/style.ts`, `output.ts`, `logger.ts`, `format.ts`.
- `src/shared/events.ts` — `Event`, `report()`.
- `src/shared/errors.ts` — `FlypathError`.
- `src/native/diagnostics.ts` — the line classifiers.

**CLI**

- `cli.ts` — a header per command; `fail()` moves to `terminal/output.ts`;
  `--verbose`; `customLogger`, `logLevel` and `clearScreen` passed to
  `createServer` and `createBuilder`; `printUrls()` removed; migration
  output; help.

**Native**

- `exec.ts` — capture by default, `onLine`, tee to the log file,
  `CommandError`.
- `ios.ts`, `android.ts` — steps; `setup-apple-spm`, `keytool` and `adb`
  captured; builds through the classifiers; the `/status` probe; launch
  without `--console-pty` unless `--console`; the device hint once.
- `release-ios.ts`, `release-android.ts` — steps, artifact line, one-line
  hints.
- `bundle.ts` — `log` callbacks become steps and warnings;
  `createNativeServer` uses the same logger.
- `device.ts` — `pick()` throws `FlypathError`s with the target rows as
  `details`.

**Vite**

- `plugins.ts` — registers `flypath:progress` (build) and the
  change-coalescing `hotUpdate` (dev); installs the report sink in
  `configureServer`.
- `prerender.ts` — a step with a counter.
- `metro-sockets.ts` — device events.
- `metro-endpoints.ts`, `dev-middleware.ts` — messages go through the
  terminal; dev-middleware info goes to verbose only.

**Runtime**

- `server-entry.tsx` — reports request and action events.
- `native-content.ts` — tracing behind the debug flag.

**Serve and jobs**

- `serve/index.ts` — one formatter for the access log; "listening" lines
  move into the primary's header.
- `serve/cluster.ts` — the `ready` message, the header, warnings.
- `jobs/run.ts` — job events. `jobs/worker.ts` — `report()` goes through
  the terminal.

**Everywhere**

- 303 prefixes removed; messages become a headline plus a hint.
- `test/serve/static.test.ts`, `test/serve/acme.test.ts` — 4 assertions
  on prefixed text.

## Tests

- `test/terminal/format.test.ts` — request, action, job and device lines:
  column alignment, no color under `NO_COLOR`, durations and sizes.
- `test/terminal/output.test.ts` — on a fake non-TTY stream, `step()`
  prints only its settled line. On a fake TTY stream, a foreign write
  during a step clears and redraws the live line. `FlypathError` and a
  plain `Error` render differently.
- `test/terminal/logger.test.ts` — `connected.`, `Re-optimizing…` and
  the node_modules sourcemap warning are hidden; a project warning is
  shown; `error(msg, { error })` prints an error block.
- `test/native/diagnostics.test.ts` — fixtures cut from real logs: the
  xcodebuild run measured above, trimmed to one dependency warning, one
  planted project warning, one error and the failure footer; and a
  Gradle failure. Asserts progress labels, the ownership filter, dedup
  and the tail fallback.
- By hand, in `example/`: a successful `flypath ios` prints five lines
  and exits; a typo in `Camera.swift` prints its file, line and the log
  path; `flypath build` prints no `dist/` rows; `flypath dev` with the
  simulator connected shows web and ios `GET` lines, a `like()` line and
  no `[vite]`; `flypath migrate --sql > x.sql` writes pure SQL.

## Phases

### Phase 0 — the foundation

`terminal/`, `FlypathError`, `--verbose`, the new `fail()`. The prefix is
removed mechanically — sentence case, wording unchanged — in one commit,
so the diff is obvious.

### Phase 1 — `flypath ios` and `flypath android`

The worst offender first: capture in `exec.ts`, the classifiers, the log
file, exit after launch, the dev server probe.

### Phase 2 — `flypath build`

The logger, the progress plugin, prerender and native steps, the
warning block.

### Phase 3 — `flypath dev`

The header, the logger, change lines, the event sink, request, action,
job and device lines, error blocks, tracing behind the debug flag.

### Phase 4 — the rest

`start`, `work`, the migration commands, `--help`.

### Phase 5 — messages

The headline-and-hint split for CLI-facing errors: native, serve,
migrations, `cli.ts`, Vite config validation. This phase needs judgment
message by message, which is why it is separate from Phase 0's
mechanical pass.

### Phase 6 — the route summary (optional)

## Key decisions

- **Quiet in the terminal, complete on disk.** Everything a subprocess
  writes goes to the log file. The terminal gets errors, the project's
  own warnings, and the path to the file.
- **Ownership decides whether a warning is shown, not severity.** 202
  warnings, none actionable, is the case this rule exists for.
- **Events from the handler, not a middleware.** It is the only layer
  that knows the route, the platform and the action, and it needs no
  denylist.
- **No dependency.** `styleText` covers color; the live line has to
  coordinate with writers no library knows about.
- **stderr for people, stdout for data.**
- **`flypath ios` exits after launch.** Device JS logs already go to
  `flypath dev`; `--console` is there for native debugging.
- **The prefix goes everywhere**, runtime messages included.
- **One formatter** for dev request lines and production access lines.

## Not in this plan

- **Keyboard shortcuts in dev**: `i` launches iOS, `a` Android, `r`
  reloads the apps through the message socket's existing `reload()`, `o`
  opens a browser. The natural next step, once the live line exists.
- **Symbolicated device errors.** `[native:error] [TypeError: …]` arrives
  with no stack. Mapping it through the dev server's sourcemaps is a
  project of its own.
- **JSON logs** for production (`accessLog: "json"`).
- **An interactive target picker** when several simulators are booted.
  Today that throws with a list; a select prompt fits once prompts are
  restyled.
- **Per-route JS sizes** in the build summary.

## Risks / open questions

- **Heuristic parsers drift** with Xcode and Gradle versions. Progress
  labels are cosmetic. Diagnostics degrade to the tail and the log path,
  never to silence.
- **Hidden output hides problems** that used to scroll past, such as a
  dependency warning that later turns out to be the cause. The log file
  and `--verbose` are the answer. Printing "202 warnings hidden" on
  success was considered and rejected: it is noise of a different
  shape.
- **Wrapping `process.stdout.write`** while a step is live is invasive.
  It is limited to the step's lifetime and restored in `finally`, but a
  crash inside a step must restore the cursor too, on `exit` and
  `SIGINT`.
- **The accent color.** Cyan is Vite's. Another hue would set flypath
  apart; this is a taste call.
- **Exiting after launch** removes the one place a native crash is
  visible today without Xcode. `--console` covers it if you remember to
  pass it.
- **Navigations versus loads.** The proposal does not distinguish a
  flight navigation from a document load in the request line, because
  the platform column already says who asked. Worth revisiting if it
  turns out to matter when debugging.
