# Flypath — deployment

## Goal

One command builds an application that can be shipped, and one command
runs it. `flypath start` serves the built app over `node:http` with no
proxy in front and no static host beside it, across every core the
machine has, over TLS it obtained itself. `flypath ios --release` and
`flypath android --release` produce a signed `.ipa` and a signed
`.aab` from the same build, pointed at that server.

Milestone: on a clean machine with a domain pointed at it,

```
flypath build
flypath migrate
flypath start
```

serves `https://example.com` on eight worker processes with a
Let's Encrypt certificate, static assets under
`Cache-Control: immutable`, and prerendered pages read straight off
disk. A second host, given the same artefact, runs `flypath work`. On a
laptop,

```
flypath ios --release
flypath android --release
```

write `App.ipa` and `app-release.aab` whose JS is Hermes bytecode
compiled from the same sources, talking to `https://example.com`, with
no cleartext exception and no dev menu compiled in. `flypath ios
--device "Vitor's iPhone"` installs a debug build on that phone and
points it at the dev server on the LAN.

## What is missing today

1. **There is no server.** `flypath build` (`cli.ts:171`) runs
   `builder.buildApp()` and stops. `dist/rsc/index.js` default-exports
   `handler(Request): Promise<Response>` and nothing calls it. Plan 17
   said this out loud: "Flypath still has no `flypath start`. This plan
   writes files into `dist/client` because that is the directory a host
   is pointed at; what fronts the app server is the deployment's
   business until there is a story for it."
2. **Nothing serves `dist/client`.** The client build writes
   content-hashed assets and the prerender step writes
   `about/index.html` and `about.flight` beside them
   (`vite/prerender.ts:62`). No process maps a URL to those files, sets
   a cache header, or decides what happens when the path is not one of
   them.
3. **Native has no build mode at all.** The native environments are
   registered only when `env.command === "serve"` (`vite/index.ts:59`),
   `nativeEnvironmentOptions` pins `process.env.NODE_ENV` to
   `"development"` (`vite/native-env.ts:40`), and `NativeBundler` is
   constructed from a `DevEnvironment` (`vite/native-serve.ts:73`).
   `BuildOptions.dev` exists (`vite/bundler.ts:49`) and no caller ever
   passes `false` from anything but a query param.
4. **The app's server URL is the dev server's.** The prelude bakes
   `serverUrl` from `NativeServer.serverUrl()`
   (`vite/native-serve.ts:89`), which is `http://localhost:8081`.
   `AppDelegate.bundleURL()` hardcodes the same
   (`templates/ios/App/AppDelegate.swift:21`). There is nowhere to say
   where the shipped app should talk.
5. **Client chunks only exist on a dev server.** `client-references.ts`
   fetches `/chunk/<platform>/<encodeURIComponent(reference)>.bundle`
   from `serverUrl` (`runtime/client-references.ts:52`), which
   `metroEndpoints` answers by building on demand out of the dev module
   graph. In build mode plugin-rsc's reference key is
   `sha256(relativeId).slice(0, 12)` instead of a Vite URL, so even the
   keys are different.
6. **The release shells are debug shells.** `MainApplication.kt:23`
   hardcodes `useDevSupport = true`; the release build type signs with
   the debug keystore and disables R8
   (`templates/android/app/build.gradle.kts:37`); the Xcode target sets
   `CODE_SIGNING_ALLOWED = NO` on **both** configurations
   (`templates/ios/App.xcodeproj/project.pbxproj:191,215`), so no
   archive can be produced and no `.xcconfig` can turn it back on.
7. **Dev-only network policy ships.** `NSAllowsArbitraryLoads` is
   application-wide in `templates/ios/App/Info.plist:28` and
   `android:usesCleartextTraffic="true"` is application-wide in
   `templates/android/app/src/main/AndroidManifest.xml:12`. Both are
   App Store / Play review flags and both exist only so a simulator can
   reach `http://localhost:8081`.
8. **There is no device path.** `runIos` picks a simulator
   (`native/ios.ts:43`), builds `-sdk iphonesimulator` and installs with
   `simctl` (`native/ios.ts:236,259`). `runAndroid` runs `installDebug`
   against whatever single device `adb` picks and reverses the port
   unconditionally (`native/android.ts:229,234`).

## The backlog the other plans left for release

Every plan that touched a client ended with a phase that was deferred
to "the release story". This is that story, so the debt is itemised
here and each item is claimed by a phase below.

**Plan 1, phase 3.** The bundle endpoint takes `dev`, and the
`dev=false` path has never produced an artefact — it would still bake
the dev server's URL into the prelude and still ship the polyfills and
the refresh runtime. Claimed by phase 3.

**Plan 3, phase 5 — the whole phase.** "Chunk emission + manifest in
`flypath build`; immutable serving; HBC precompile decision.
Acceptance: release-mode app on both platforms renders and runs the
counter against a production server; chunk fetch happens once and
caches." None of it exists. Its four risks are still live and are
answered below: module identity between base and chunk, react-refresh
in fetched chunks (moot in release — refresh is stripped), App Store
3.3.2, and **version skew** ("a device holding a long-lived session
across a server deploy can reference chunks the new server no longer
serves … need a payload-level build-version marker that triggers a
clean reload"). Claimed by phases 3, 4 and 5.

**Plan 4, "Production".** "Build-mode reference keys are hashes; the
native chunk build must run the same use-server transform under build
config so keys match the rsc build's server manifest." There is no
native build config, so the transform has never run under one.
Claimed by phase 4.

**Plan 5, phase 6.** "Release (`flypath build`) wiring … release builds
of the example pass the full test matrix." Half-true today: `flypath
build` does call `scaffoldNative` (`cli.ts:172`), so the Swift/Kotlin
shims and the native manifest are generated in a build; nothing then
compiles an app. Plan 5's dev-loop section names the missing half
exactly: "the JS half of release follows the client-components plan's
Phase 5". Claimed by phases 3 and 6.

**Plan 14, risks.** "`runnerImport` in production. `migrate` on a
deploy target loads `.ts` through Vite." Resolved since: the root
export map's `node` condition means `migrations/files.ts` uses a bare
`import()` on Node's type stripping and never starts Vite. What
remains is a packaging fact, not a bug — `db/schema.ts` and
`db/migrations/*.ts` must be present as **source** on the deploy
target. Documented in "Deploying the artefact".

**Plan 15.** "The server entry is the only production artefact …
there is no `flypath start`; a worker has to load application code the
same way a server would, so it loads that file." `flypath work` already
does exactly that (`cli.ts:138`) and needs no change: it is a separate
process on a separate host with its own supervisor, and `flypath dev`
already starts one in-process for the dev loop (`cli.ts:62`). What this
plan owes it is only that `flypath build` keeps producing the artefact
it loads, and that the deploy checklist says what a worker host needs.
Claimed by phase 1.

**Plan 17, "Not in this plan".** "Serving." Claimed by phases 1 and 2.
Also still open from that plan and **not** claimed here: a dev-time
throw for `query()` in a client component on a prerendered page.

**TODO.** "Release build", "Lock down dev-only network config",
"Skew" and "Run on device" are this plan. "Unify logging on the
framework" is adjacent and gets the minimum it needs (phase 2's access
log) without being solved. "Deep links are wired but unexercisable"
becomes shippable-relevant here — a released app that cannot be opened
by URL cannot do universal links or app links — and is called out under
"Not in this plan" as the small separable follow-up it is.

**Nine more gaps, found while reading for this plan and in no plan or
TODO.**

1. `cpp/FlypathHermesRuntime.cpp:59` enables Hermes sample profiling
   unconditionally, in every build.
2. `<img src>` on native maps to `{ uri: src }`
   (`components/native/primitive.tsx:451`). A root-relative `src`
   resolves against the document on web and against nothing on a
   device. Release needs relative `src` resolved against `serverUrl`.
3. Native asks for the document path with `x-flypath-platform` rather
   than for `<path>.flight` (`runtime/native-root.tsx:71`), so a static
   host cannot answer a native navigation and any static layer in front
   has to inspect headers to stay correct.
4. Nothing anywhere handles `SIGTERM` except the jobs worker
   (`cli.ts:50`). No drain, no health endpoint, no access log.
5. The build artefact is not self-contained: `dist/rsc/index.js`
   imports `postgres`, `nodemailer`, `croner` and `node:*` as
   externals, and reaches SSR through a relative
   `import("../ssr/index.js")`.
6. Hermes release stacks need the composed packager+compiler source
   map to symbolicate. Nothing produces one and nothing keeps it.
7. `example/.gitignore` does not exist and `flypath start` wants a
   writable state directory for certificates.
8. `mail.baseUrl` (`example/vite.config.ts:9`) is the app's public
   origin under a second name; a release native build needs the same
   value a third time.
9. `defineConfig`'s option object is `UserConfig & FlypathOptions`
   (`vite/index.ts:83`), so any new production-server key has to avoid
   colliding with Vite's `server`, `preview`, `build` and `base`.

## Field notes — prior art

**Next.js.** `next build` then `next start`, a Node server the
framework owns, plus `output: "standalone"` which traces the module
graph and copies a minimal `node_modules` next to the server so the
deploy artefact is self-contained. Two lessons: the framework, not the
user, decides what the production server does with `Cache-Control`;
and "which files do I actually have to copy" is a question the
framework should answer, not the user.

**Remix / React Router.** Ships adapters, not a server: `@remix-run/express`,
`@remix-run/node` and a `createRequestHandler(build)`. The lesson is the
seam — a built module exporting a request handler, and a thin adapter
per host — which flypath already has by construction, because
`dist/rsc/index.js` default-exports a Web `Request → Response`
function.

**Caddy.** Automatic HTTPS is the default, not a flag: on first listen
it obtains a certificate over ACME, keeps an account key and the
certificates in one storage directory, renews at a third of the
lifetime remaining, and falls back from TLS-ALPN-01 to HTTP-01. It
also runs an unconditional `:80` listener for the challenge and the
redirect. The lessons: one storage directory with a documented layout;
renew on a timer, never on a request; and never let a certificate
failure take the plain listener down with it.

**Bun / Deno.** `Bun.serve` and `Deno.serve` take a `fetch(Request)`
function and a `reusePort` flag, and clustering is "run the process N
times". Node's `cluster` is the same idea with the primary owning the
listening socket. The lesson is that the process model belongs to the
runner, not to the app: nothing in the handler may hold per-process
state that has to be shared.

**Expo (EAS) and CodePush.** The split flypath already has —
a binary shell plus JS delivered over the air — is theirs, and the
thing they both learned the hard way is that **the JS and the binary
have a compatibility contract**, expressed as a runtime version.
CodePush pins by app version and refuses mismatched packages; EAS
Update carries a `runtimeVersion` and an update is only offered to a
binary that declares the same one. Flypath's equivalent is the base
bundle's module set, and the lesson is to name it, ship it in the
binary, send it on every request, and fail loudly rather than
half-work.

**Metro.** Does not tree-shake. A release bundle is the same
concatenation of `__d` factories as a dev bundle, minified, then
compiled to Hermes bytecode; the win comes from HBC, not from the
bundler. This is the permission slip to reuse flypath's existing
bundler for release rather than write a second, rollup-shaped one.

**Rails / Puma, Gunicorn.** Worker count from a config file with an
environment override (`WEB_CONCURRENCY`), phased restart, and a
`preload_app` decision. The lesson taken: `cluster: false` must be a
first-class answer, because one process per container is what every
orchestrator wants.

## Options considered

### Where the production server lives

A separate `flypath-node` package, an adapter interface with
`flypath start` picking one, or one server in the framework.

One server, in the framework. The request is explicit — standalone and
behind nginx, static files, cluster, TLS — and every one of those is a
property of the same `node:http` server. An adapter interface with one
implementation is a seam with nothing on the other side, and the
handler is already the seam: anyone who wants Workers or Deno imports
`dist/rsc/index.js` and calls it. The TODO's "Engines — I should be
able to plug in hono for apis" is the same seam from the other side and
is not this plan.

### Static files: in the server, or "point nginx at `dist/client`"

Requiring a static host in front would make "standalone" false, and
it would put the cache policy for content-hashed assets in the user's
nginx config, where it will be wrong. The server serves
`dist/client` itself, and does it well enough that putting nginx in
front is an optimisation rather than a fix. Behind a proxy the same
code path is simply never reached, because nginx answers first.

### The process model

`node:cluster` (primary + N workers sharing one listening socket),
`SO_REUSEPORT` with N independent processes, or worker threads.

`node:cluster`. It is in the standard library, the primary is a natural
owner for the things that must happen once — ACME, graceful
shutdown — and workers get restart-on-crash for free. Worker
threads share a heap, which buys nothing for a request handler and
costs isolation. `reusePort` is the better primitive on Linux and is
noted as a future switch; it does not change the shape.

### ACME: which library

Measured 2026-09-10, `npm i` into an empty project:

|                                        | licence               | packages | size   | last publish      |
| -------------------------------------- | --------------------- | -------- | ------ | ----------------- |
| `@small-tech/auto-encrypt` 6.2.1       | **AGPL-3.0-or-later** | 4        | 1.8 MB | 2026-09-06        |
| `acme-client` 5.4.0                    | MIT                   | 48       | 10 MB  | 2024-07-16        |
| `@certd/acme-client` 1.44.3 (a fork)   | MIT                   | 54       | 20 MB  | 2026-09-06        |
| `greenlock` / `acme-v2` / `@root/acme` | MPL-2.0               | 10+      | —      | abandoned 2022–24 |
| `@peculiar/x509` 2.1.0 (CSR only)      | MIT                   | 5        | 4.3 MB | 2026-09-04        |

**Auto Encrypt is the best-engineered of these and flypath cannot use
it.** Four packages, ARI-based renewal, Node 24+, actively developed —
and AGPL-3.0-or-later, with its `@small-web/x509` dependency AGPL too.
Small Tech chose that deliberately; it is their model. But flypath is
MIT and exists to be embedded in other people's applications and run as
a network service, which is exactly the case AGPL §13 is written for.
Shipping it would mean every flypath app that turns on HTTPS has to
offer its source to its users. A framework does not get to make that
choice on behalf of the people using it, even with a warning, and
"optional peer dependency" does not change what the combined running
work is. Ruled out on the licence, not on the engineering.

**`acme-client` is the honest "just take a library" answer**, and it
costs 48 packages and 10 MB — more than the pg-boss install plan 15
turned down at 23 and 7.6 MB — for `axios` where Node has `fetch` and
`node-forge` where Node has `node:crypto`. It has not been published
since July 2024, which for a protocol frozen at RFC 8555 is survivable,
though it means no ARI. The fork adds proxy agents and `lodash-es` to
get to 54 and 20 MB.

The thing none of them removes is the integration. Auto Encrypt wants
to own `createServer`, which collides with a server that already owns
its listeners, its SNI and its cluster; `acme-client` is a protocol
client, so the challenge route, the storage layout, the renewal timer
and the "only the primary does this" coordination are yours either way.
A full library saves the protocol, not the wiring.

So split it where the risk actually is. The protocol half — ES256 JWS,
a JWK thumbprint, six directory endpoints, polling — is ordinary
`node:crypto` + `fetch` code with no byte-level encoding in it, and it
tests against a stub directory. The CSR is the part that fails against
a rate-limited service with a generic error, and `@peculiar/x509` does
exactly that in five MIT packages, published last week, on Node's own
WebCrypto: `Pkcs10CertificateRequestGenerator.create()` with a
`SubjectAlternativeNameExtension`.

**Hand-rolled protocol, `@peculiar/x509` for the CSR.** It deletes the
risk this plan flagged as its worst, keeps flypath owning the parts
that have to reach into its own server, and costs five packages. Two
guard rails stay: the ACME code sits behind `serve.tls.acme` and never
runs unless configured, and a failure to issue or renew never takes
down a listener that is already serving. If the protocol layer turns
out to be more maintenance than it looks, `acme-client` drops in behind
the same `obtain(domains) → { key, cert }` seam.

`@peculiar/x509` is an optional peer dependency, loaded by a lazy
`import()` inside `serve/acme.ts` the way `cli.ts` already loads
everything it does not always need. Nobody who does not configure
`serve.tls.acme` installs it, and anybody who does gets an error naming
the package and the install line.

### Native release JS: reuse the dev bundler, or write a build bundler

The dev bundler is not a dev-time convenience. It is metro-runtime's
registry, the Babel quarantine with codegen, the lazy-require proxy
layer and the chunk splitter — four things RN's runtime contracts
depend on and that a rollup build would have to reproduce exactly
(see [[native-pipeline-deviations]]). Metro does not tree-shake either.

Reuse it: `flypath build` creates a Vite server in middleware mode,
without listening, purely to own the `native_ios` / `native_android`
environments, and drives the same `NativeBundler` with `dev: false`.
Minification and dead-code elimination come from Hermes: `hermesc -O`
on a bundle where `__DEV__` is a literal `false` removes the dev
branches at compile time.

### Client chunks in release: inline, fetch, or both

**Inline everything** into the base bundle: no network, but the
binary's copy of a client component is frozen at build time, so a
server deploy that changes one silently disagrees with the app. That
breaks the framework's own claim.

**Fetch everything** from the server, as dev does: always correct,
always current, and a cold launch pays a round trip per client
component before first paint.

**Both.** Chunks are content-addressed and served as immutable files;
the binary ships the chunks from its own build as a _seed_ keyed by
content hash. If the server's hash for a reference matches a seeded
chunk, it is used with no network at all; if it differs — because the
component changed since the binary was built — it is fetched. Correct
by construction, fast in the common case, and the seed is free because
the chunks are built anyway.

The cost is one extra fact on the wire: the app must know the server's
hash for a reference before it decides. Options were an `ETag`
conditional GET per chunk (no manifest, one small round trip per chunk
per launch) or one manifest per server build. The manifest wins:
one request per **deploy**, not per chunk, and it is a static file, so
a CDN answers it.

### Skew: refuse, or degrade

A chunk built against build M's base bundle excludes every module in
M's base. Handing it to a binary whose base is from build N is only
safe if N's base is a superset for that chunk's needs, which nothing
can check cheaply.

The base module set gets a name — `baseId`, hashed the same way the
native manifest already hashes itself (`native/manifest.ts:898`) —
compiled into the binary, sent on every payload and chunk request, and
compared. Matching: everything works. Not matching: seeded chunks
still resolve (they are in the binary), so the app keeps working for
every screen built from components it already has, and a reference it
does not have is a hard, named error rather than a corrupt module
graph. This is plan 3's "payload-level build-version marker" and the
TODO's "Skew", and it reuses the `/flypath-skew` reporting path that
already exists for `"use native"` (`runtime/native-bindings.ts:25`).

## Shape

```
vite.config.ts
  url:   "https://example.com"     ← one public origin, used by all three
  serve: { cluster, tls, static, … } ← how `flypath start` runs

flypath build
  dist/client/                      ← everything a CDN can serve
    assets/*                        immutable, content-hashed
    about/index.html, about.flight  prerendered (plan 17)
    chunk/ios/<key>-<hash>.bundle   native client chunks
    chunk/android/…
    native/ios.json                 { baseId, chunks: { key: hash } }
  dist/rsc/index.js                 default export: Request → Response
  dist/ssr/index.js
  dist/native/ios/main.jsbundle     base bundle (source + HBC + map)
  dist/native/android/index.android.bundle

flypath start
  primary: ACME, supervision, shutdown
  workers: node:http | node:https → static → handler

flypath work        ← a different host, same artefact, its own supervisor

flypath ios --release      → dist/App.ipa   (or archive only, or upload)
flypath android --release  → dist/app-release.aab
```

## The server

### `flypath start`

```
flypath start
  --port <port>        override serve.port
  --host <host>        override serve.host
  --cluster <n>        worker count; 0 or "off" for a single process
```

It loads `.env` (`db/config.ts:47`), reads `serve` out of
`vite.config.ts` through `loadOptions` (`native/config.ts:139` — a
plain Node import, no Vite), then either becomes a single server or
becomes a cluster primary. It never imports Vite.

Each worker imports `dist/rsc/index.js` once, takes the default export,
and serves it. That is the same module `flypath work` already loads
(`cli.ts:141`), which is what lets a worker host run the same artefact
and agree on application code by construction — without this server
having anything to do with it.

### The node adapter

`src/serve/adapter.ts`, and it is the only place that knows about
`IncomingMessage`.

Request in: method, an absolute URL from scheme + authority + `req.url`,
headers verbatim, and a body. The body is `Readable.toWeb(req)` with
`duplex: "half"` for anything that has one, and `undefined` for
GET/HEAD — server actions post both `text` and `multipart/form-data`
(`runtime/server-entry.tsx:117`) and `Request.formData()` on Node
parses the latter, so nothing hand-rolls multipart on this side. An
`AbortController` tied to `req`'s `close` becomes `request.signal`, so
a client that hangs up cancels the render.

Scheme and authority come from `X-Forwarded-Proto` / `X-Forwarded-Host`
/ `Forwarded` **only when the connection's remote address is trusted**
(`serve.trustProxy`), and from the socket and `Host` otherwise. This is
load-bearing beyond cosmetics: `handler` builds `new URL(request.url)`
and compares origins before following a redirect
(`runtime/server-entry.tsx:516`), so getting the origin wrong turns an
internal redirect into an external one.

Response out: status, headers, and `Readable.fromWeb(response.body)`
piped to `res`, with `getSetCookie()` appended rather than joined —
`withOutgoing` already appends multiple `set-cookie` values
(`runtime/server-entry.tsx:210`) and a naive `Object.fromEntries` would
collapse them. `HEAD` sends headers and discards the body. Errors
during streaming destroy the socket rather than trying to write a
status that has already been sent.

### Static files

Before the handler, and only when **all** of these hold: the method is
GET or HEAD, the request carries no `x-flypath-*` header, and the
resolved path is inside `serve.static.dir` (default `dist/client`).

The rule about headers is the important one. Native fetches the
document path with `x-flypath-platform` and expects a flight payload
(`runtime/native-root.tsx:71`), and plan 17's design is that
"prerendering never removes a route" — the server can always render it.
Serving `about/index.html` to that request would hand HTML to a device.
One header check keeps the static layer purely path-based for everyone
who is allowed to use it.

Resolution, in order: exact file; `<path>/index.html`; nothing.
`about.flight` is an exact file and needs no special case, which is
what plan 17 bought by moving the payload onto a path.

Headers: `ETag` from size and mtime (weak), `Last-Modified`,
`Content-Type` from a small extension table plus
`text/x-component;charset=utf-8` for `.flight`, `Accept-Ranges` and
single-range `206` support, and `Cache-Control`:

- anything under `assets/` or `chunk/` — content-hashed by the build —
  `public, max-age=31536000, immutable`;
- `native/*.json` — `public, max-age=0, must-revalidate` (it is the
  thing that changes on deploy);
- everything else — `public, max-age=0, must-revalidate`.

Compression: `flypath build` writes `.br` and `.gz` sidecars for every
text asset over 1 KB, and the static layer picks one from
`Accept-Encoding` with `Vary: Accept-Encoding`. Dynamic responses from
the handler are compressed on the fly with `node:zlib` above the same
threshold, off by default when `serve.trustProxy` is set — a proxy
that already compresses should not be handed a second pass.

### Cluster

`serve.cluster` is `true` (default, `os.availableParallelism()`), a
number, or `false`. `FLYPATH_CLUSTER` and `WEB_CONCURRENCY` override.
`false` or `1` means no primary at all — the process listens directly,
which is what a container wants.

The primary forks workers, restarts one that exits non-zero with
exponential backoff capped at 30 s, and refuses to restart-loop: five
failures inside 10 s and it exits with the child's code, because a
worker that cannot boot is a deploy that must fail.

The cluster runs web workers and nothing else. Jobs are a separate
deployment — usually a separate host, sized differently, scaled
differently and restarted on a different schedule — started with
`flypath work` against a copy of the same `dist/`, supervised by
whatever supervises everything else there. `flypath dev` already runs
a worker in-process (`cli.ts:62`), so the dev loop is covered too and
neither end needs a flag. Forking one here would put a queue on
whichever host happens to serve HTTP; forking one per web worker would
multiply every queue's configured concurrency by the core count, which
is never what the `concurrency: 5` in `vite.config.ts` meant.

Shutdown: `SIGTERM`/`SIGINT` on the primary broadcasts a stop, each web
worker closes its listener, keeps serving in-flight requests, sets
`Connection: close` on responses to keep-alive connections, and exits
when the last one finishes or `serve.shutdownTimeout` (default 25 s)
expires. The primary exits last. (A jobs host drains on its own
signal handler, which `flypath work` already has — `cli.ts:50`.)

`GET /_flypath/health` is answered by the worker itself without
touching the handler: `200` while accepting, `503` once draining. That
last part is the entire point — it is what makes a rolling deploy stop
sending traffic to a process that is on its way out.

### TLS

```ts
serve: {
  tls: {
    key: "./certs/privkey.pem",
    cert: "./certs/fullchain.pem",
    port: 443,
    redirect: true,
  },
}
```

Files are read once per worker; `SIGHUP` re-reads them and calls
`server.setSecureContext()` without dropping connections, which is what
makes an externally-managed certificate (certbot, a mounted secret)
renewable without a restart.

With `tls`, the plain listener stays up on port 80 and does exactly two
things: ACME challenges and `308` to `https://` + host + original URL.

### Let's Encrypt

```ts
serve: {
  tls: {
    acme: {
      email: "ops@example.com",
      domains: ["example.com", "www.example.com"],
      directory: "production",       // or "staging", or a URL
      storage: "./.flypath/certs",
      renewBefore: 30,               // days
      agree: true,                   // ToS
    },
  },
}
```

`src/serve/acme.ts`, HTTP-01 only, ~250 lines against `node:crypto`
and `@peculiar/x509`:

- **Account.** ES256 (P-256) key at `<storage>/account.key`, created on
  first run. JWS with `alg: ES256`; `jwk` on `newAccount`, `kid`
  after. Nonces from `newNonce` and from every `Replay-Nonce` header.
- **Order.** `newOrder` with the domains, then for each authorization
  the `http-01` challenge: the key authorization is
  `token + "." + base64url(sha256(JWK thumbprint))`, published at
  `/.well-known/acme-challenge/<token>` by the plain listener, then
  `POST` the challenge URL and poll the order.
- **CSR.** A P-256 key per certificate from `crypto.webcrypto`, and a
  PKCS#10 from `x509.Pkcs10CertificateRequestGenerator.create()` with
  the domains as a `SubjectAlternativeNameExtension` and an empty
  subject, signed `ECDSA`/`SHA-256`. `x509.cryptoProvider.set(webcrypto)`
  once at module load; nothing hand-encodes DER.
- **Finalize**, poll, download the chain, write
  `<storage>/<primary domain>/{privkey,fullchain}.pem` and a
  `meta.json` with the not-after date.
- **Renewal.** An hourly timer in the primary; renew when less than
  `renewBefore` days remain — Let's Encrypt's own guidance is a third
  of the lifetime, so 30 of 90. ARI (RFC 9773) would replace that
  arithmetic with the CA's own answer and is advisory today; it is one
  `GET` against `renewalInfo` and belongs here the day certificate
  lifetimes get short enough for the heuristic to be wrong.

Only the primary runs any of this, and an advisory lock file in
`storage` keeps two servers on a shared volume from racing. On success
the primary broadcasts `tls-reload`; workers call `setSecureContext()`.

Cold start with no certificate: the plain listener comes up first, the
primary obtains, and only then do workers bind 443 — with a log line
per step, because "the first boot takes twenty seconds and then it
works" is only frightening when it is silent. A failure at that point
is fatal (there is nothing to serve on 443); a failure at renewal is a
loud warning and a retry, because the existing certificate is still
good.

### Behind a proxy

`serve.trustProxy` takes `true`, a hop count, or a list of CIDRs.
Trusted: `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For`
(rightmost untrusted entry becomes the client address) and `Forwarded`
are honoured. Untrusted: all four are ignored, always. The default is
`false`, so a server exposed directly cannot be told it is on HTTPS by
a header.

Everything else is unchanged: nginx answering `/assets/*` from disk
just means the static layer never runs.

### Deploying the artefact

`flypath build` prints what must be copied, because the answer is not
obvious: `dist/`, `package.json`, `node_modules` (or a production
install), `db/schema.ts` and `db/migrations/*.ts` as **source** —
`flypath migrate` imports them through Node's type stripping — and
`.env` or the equivalent. `dist/rsc/index.js` externalises `postgres`,
`nodemailer` and `croner`, and reaches SSR by a relative
`import("../ssr/index.js")`, so `dist/` moves as a unit. Tracing a
minimal `node_modules` the way Next's `standalone` does is noted under
"Not in this plan".

A worker host takes the same list and runs `flypath work` instead of
`flypath start`. Nothing else differs: same `dist/`, same `.env`, same
database. A web host does not need `db/migrations/` unless it also runs
`flypath migrate`, and the checklist says which lines are for which
role.

### Configuration

`FlypathOptions` gains two keys. `serve` rather than `server` because
`FlypathConfig` is `UserConfig & FlypathOptions` (`vite/index.ts:83`)
and Vite owns `server`; `defineConfig` throws a message that says so if
it finds flypath keys under `server`.

```ts
url?: string;              // the public origin

serve?: {
  port?: number;           // ?? PORT ?? 3000
  host?: string;           // default "::"
  cluster?: boolean | number;
  static?: false | { dir?: string; compress?: boolean };
  compress?: boolean;
  trustProxy?: boolean | number | string[];
  shutdownTimeout?: number;
  tls?: {
    key?: string; cert?: string; ca?: string;
    port?: number; redirect?: boolean;
    acme?: {
      email: string; domains: string[]; agree: true;
      directory?: "production" | "staging" | string;
      storage?: string; renewBefore?: number;
    };
  };
};
```

`url` is the single public origin. It defaults from `APP_URL`, which
`mail/config.ts:19` already reads, and it in turn defaults
`mail.baseUrl`, so that value stops being typed twice. Native release
builds bake it. `FLYPATH_URL` overrides at build time, which is how one
repository produces a staging build and a production build.

## The clients

### Web

The server is the whole missing piece, with three exceptions that this
plan also closes.

Relative `<img src>` on native (`components/native/primitive.tsx:451`)
becomes `{ uri: new URL(src, serverUrl).href }` when `src` is not
absolute — a bug in dev too, invisible because `serverUrl` and the
document origin happen to coincide.

Native asks for `<path>.flight` instead of the document path with a
platform header (`runtime/native-root.tsx:71`). `flightPath()` already
exists (`shared/flight.ts`) and the server already strips the suffix
(`runtime/server-entry.tsx:229`), so this is a two-line change that
makes every native navigation a plain path a CDN could answer, and
removes the last reason for the static layer to think about headers
at all. The header check stays as the belt to that braces — `SCREEN`,
`CHROME` and `FRAGMENT` still vary the payload for a non-prerendered
route.

The precompressed sidecars come from the build.

### Native: the release base bundle

`flypath build --platform ios,android` (and implicitly, a release app
build) creates a Vite server in middleware mode — created, never
listened on — solely to own the `native_*` environments, then drives
the existing `NativeBundler`:

- `nativeEnvironmentOptions` takes the mode: `__DEV__` becomes the
  literal `false` and `process.env.NODE_ENV` becomes `"production"`
  (`vite/native-env.ts:40`).
- `nativeRefresh()` is already `apply: "serve"` and so drops out on
  its own; the prelude's `dev` flag is `false`, so `wrapModule` emits
  no HMR bookkeeping (`vite/bundler.ts:462`).
- `serverUrl` in the prelude becomes `url` from the config. Not
  configured, and a release build is an error that names the key.
- `baseId` joins the prelude: `hash(platform + rn version + flypath
version + sorted module ids of the base closure)`, using
  `styles/hash.ts` as the native manifest already does.

Output: `dist/native/<platform>/` holding the source bundle, the source
map, and `main.jsbundle` / `index.android.bundle` compiled by
`hermesc -O -output-source-map` from
`node_modules/hermes-compiler/{osx,linux64,win64}-bin/hermesc` — the
same binary RN's own Xcode script resolves for SwiftPM consumers
(`react-native/scripts/react-native-xcode.sh:96`), which is what
guarantees the bytecode version matches the prebuilt VM. The packager
map and the compiler map are composed with
`react-native/scripts/compose-source-maps.js` into one
`main.jsbundle.map`, kept out of the app and left in `dist/` for
whatever symbolicates crashes later.

Hermes with `__DEV__` as a literal `false` is what removes the dev
branches; there is no separate minifier.

### Native: chunks, the manifest, and skew

At build time, for each platform:

1. Every module carrying a `"use client"` directive in the `rsc`
   environment is recorded with its root-relative id and
   `sha256(relativeId).slice(0, 12)` — plugin-rsc's own key
   (`plugin-Cbs9j6lP.js:244,1381`), reproduced rather than read out of
   its internals, and asserted against `clientReferenceDeps` in the
   emitted assets manifest so a divergence fails the build instead of
   the app.
2. `NativeBundler.buildChunk` runs for each, against a base whose
   module set is already recorded, so the existing `!this.base.has(id)`
   filter (`vite/bundler.ts:484`) is exactly plan 3's "chunk must not
   contain modules the base provides" check — made a build-time
   assertion with a message rather than a silent filter.
3. Chunks are written to
   `dist/client/chunk/<platform>/<key>-<contentHash>.bundle`, immutable
   by construction, plus `.map` beside each.
4. `dist/client/native/<platform>.json` is written:
   `{ baseId, build, chunks: { <key>: "<key>-<hash>.bundle" } }`.
5. The same chunk sources are appended to the base bundle as a **seed**
   and registered as `__FLYPATH__.seeded[<key>-<hash>] = <moduleId>`,
   so the bytecode in the binary contains them.

At runtime, `client-references.ts` gains one step before `download()`:
resolve the reference through the manifest for the server's current
build, and if the resulting `<key>-<hash>` is in `__FLYPATH__.seeded`,
require it with no network. The manifest is fetched once and re-fetched
only when a response's `x-flypath-build` header changes; every flight
response carries that header, so a deploy is noticed on the next
navigation.

`baseId` rides every chunk and manifest request. On mismatch the server
answers `409` with a message; the app keeps rendering everything its
seeded chunks cover, reports once through the existing
`/flypath-skew` endpoint (`vite/metro-endpoints.ts:154`), and turns a
reference it cannot resolve into the named error the ErrorBoundary
already shows. `serve.minimumBuild` lets a server declare an older
binary unsupported outright, which is answered with a `426` the app
turns into an "update required" screen.

Chunks stay JavaScript in release; they are evaluated through
`globalEvalWithSourceUrl` as they are today
(`runtime/client-references.ts:29`), and Hermes eval is on because
flypath's own runtime config does not disable it
(`cpp/FlypathHermesRuntime.cpp:57`). HBC chunks would need a byte
buffer handed to the VM, which flypath's C++ module could do and which
nothing needs yet; it is in "Not in this plan" with the seam named.
That also settles plan 3's "HBC precompile decision": the base bundle
is bytecode, chunks are source, and the seed means the common path
evaluates no source at all.

### iOS release

`flypath ios --release [--archive-only] [--upload] [--xcode]`.

The materialised shell (`node_modules/.flypath/ios`) gains a
`Bundle/` synchronized folder — one more
`PBXFileSystemSynchronizedRootGroup`, the same mechanism as `Resources`
(`templates/ios/App.xcodeproj/project.pbxproj:20`), which plan 13
already proved survives `setup-apple-spm.js`. A release build writes
`main.jsbundle` into it; a debug build leaves it empty and
`bundleURL()`'s `#if DEBUG` branch never looks.

`CODE_SIGNING_ALLOWED = NO` and `CODE_SIGNING_REQUIRED = NO` come out
of the Release target configuration and stay in Debug for the
simulator. Signing itself is not invented: `<root>/apple/App.xcconfig`
is already passed to `xcodebuild` when it exists
(`native/ios.ts:241`), and that is where `DEVELOPMENT_TEAM`,
`CODE_SIGN_STYLE` and `PROVISIONING_PROFILE_SPECIFIER` belong — a file
on disk, in the overlay, per plan 13's "scalars in config, files in the
overlay". `ios.teamId` in `vite.config.ts` writes `DEVELOPMENT_TEAM`
for the common case where that is the only setting anyone needs.

Then:

```
xcodebuild archive -project … -scheme App -configuration Release \
  -destination "generic/platform=iOS" -archivePath dist/App.xcarchive \
  -allowProvisioningUpdates [-authenticationKeyPath … -authenticationKeyID … -authenticationKeyIssuerID …]
xcodebuild -exportArchive -archivePath dist/App.xcarchive \
  -exportOptionsPlist <generated> -exportPath dist
```

The export options plist is generated from
`ios.distribution` (`"app-store" | "ad-hoc" | "development" |
"enterprise"`, default `app-store`), and `--upload` sets
`destination: upload` in it, which hands the build to App Store Connect
from `xcodebuild` itself with no `altool` and no Transporter. With an
App Store Connect API key configured, TestFlight and the App Store are
both reachable from the CLI; without one, `--archive-only` stops at the
`.xcarchive` and prints the two commands to finish by hand, and
`--xcode` opens the project so the Organizer can do it.

So: the CLI is enough, and Xcode remains the escape hatch rather than
the requirement.

### Android release

`flypath android --release [--apk] [--xcode-equivalent: --studio]`.

`app/build.gradle.kts` changes shape:

- `react { debuggableVariants = listOf("debug", "release") }` so RN's
  `createBundleReleaseJsAndAssets` task is never created
  (`TaskConfiguration.kt:51`) — flypath produced the bundle already —
  while `configureJsEnginePackagingOptions` and the `noCompress` on
  `.bundle` (`ReactPlugin.kt:175`) still apply, which is what lets the
  bundle be memory-mapped instead of inflated at launch.
- `index.android.bundle` is written to
  `app/src/main/assets/` for a release build only, and AGP packages it.
- The release build type gets `isMinifyEnabled = true`,
  `isShrinkResources = true`, RN's `proguard-rules.pro` plus a flypath
  rules file that keeps the generated view managers and TurboModules —
  the classes named by `__FLYPATH_VIEW_NAMES__`
  (`native/android.ts:197`) are reached reflectively and R8 cannot see
  it.
- The release signing config reads `<root>/android/keystore.properties`
  (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), with
  `FLYPATH_ANDROID_*` environment overrides for CI. Secrets stay out of
  `vite.config.ts`; the file is the Android convention and belongs in
  `.gitignore`. Missing, and a release build fails with the four keys
  named and the `keytool -genkeypair` line to create the store.
- `MainApplication.kt:23` becomes `useDevSupport = BuildConfig.DEBUG`.

`./gradlew bundleRelease` produces the `.aab` Play requires;
`--apk` runs `assembleRelease` for sideloading and for anything that is
not Play. Uploading to Play needs the Play Developer API and a service
account, which is a different project — the path is printed and
`bundletool`/`fastlane supply` are named. Android Studio is never
required; opening the materialised project is available for the same
reasons Xcode is.

### Locking down dev-only network policy

Both platforms currently ship an application-wide cleartext exception
(TODO item two). Neither is needed by anything but the dev loop.

**iOS.** Two plists: `Info.plist` with no
`NSAppTransportSecurity` at all, and `Info.debug.plist` with
`NSAllowsLocalNetworking` (not `NSAllowsArbitraryLoads`) plus
`NSLocalNetworkUsageDescription`, selected by `INFOPLIST_FILE` per
build configuration. The consumer overlay's plist merge
(`native/ios.ts:74`) applies to both, so nothing the user writes is
lost. `NSAllowsLocalNetworking` covers `localhost` and private ranges,
which is exactly the dev server on a LAN and nothing else.

**Android.** `android:usesCleartextTraffic` comes off the main manifest
and a `src/debug/AndroidManifest.xml` supplies it along with a
`network_security_config.xml` whose cleartext permit list is the dev
host and `10.0.2.2` (the emulator's route to the host — see
[[native-pipeline-deviations]]). AGP's manifest merger does the rest,
which is plan 13's rule: the platform's merger does the merging.

Acceptance is mechanical: `aapt2 dump xmltree` on the release APK finds
no `usesCleartextTraffic`, and `plutil -p` on the release `Info.plist`
finds no `NSAppTransportSecurity`.

## Running on a device

This is a separate feature that shares three mechanisms with release,
which is why it is here rather than in its own plan: **code signing**
(an iOS device build needs it even in Debug), **the server URL**
(`localhost` is the device itself), and **the cleartext policy** (a
debug build talking `http://` to a LAN address is precisely what
`NSAllowsLocalNetworking` is for). Everything below reuses what the
sections above build.

**Picking a target.** `--device <name|udid|serial>` selects across
simulators _and_ devices. iOS devices come from
`xcrun devicectl list devices --json-output`; Android from
`adb devices -l`. With no `--device` and more than one candidate, the
CLI lists them and exits rather than guessing.

**The URL.** A device build resolves the dev host to the machine's LAN
address — the first non-internal IPv4 from `os.networkInterfaces()`,
overridable with `--host` — and that value flows to three places that
are all `localhost` today: the prelude's `serverUrl`
(`vite/native-serve.ts:89`), `AppDelegate.bundleURL()`
(`templates/ios/App/AppDelegate.swift:21`, which becomes
`__FLYPATH_DEV_HOST__`), and the Android network security config. The
dev server already binds all interfaces
(see [[native-pipeline-deviations]]), so nothing changes server-side.

**iOS.** `-sdk iphoneos`, `-destination "id=<udid>"`, signing from the
same `App.xcconfig` the release path uses, `-allowProvisioningUpdates`
so a free or personal team can provision on the fly. Install and launch
with `xcrun devicectl device install app --device <udid> <App.app>` and
`xcrun devicectl device process launch --console --device <udid>
<bundleId>`. `idb` stays available for UI automation but is not on the
build path.

**Android.** `adb -s <serial>` everywhere, `installDebug`, and
`adb reverse tcp:8081 tcp:8081` — which works over a TCP transport as
well as USB, so a device paired with `adb pair` / `adb connect` reaches
the dev server on `localhost` and [[android-cookies-verified]] holds
unchanged. If `reverse` fails (it does on some OEM builds), the CLI
falls back to the LAN address and says which one it used.

**The prompt.** iOS 14+ asks for local-network permission the first
time an app talks to a LAN address; without
`NSLocalNetworkUsageDescription` the app is denied silently and the
bundle fetch just fails. That key is in the debug plist above, and the
CLI says so if the first fetch times out.

## What changes

**New**

- `src/serve/index.ts` — `start(options)`, the entry both the CLI and
  the cluster workers use.
- `src/serve/adapter.ts` — `IncomingMessage` ↔ `Request`/`Response`.
- `src/serve/static.ts` — the file layer, ETags, ranges, encodings.
- `src/serve/cluster.ts` — primary, workers, supervision, shutdown.
- `src/serve/tls.ts` — contexts, `SIGHUP`, `setSecureContext`.
- `src/serve/acme.ts` — the ACME client (`@peculiar/x509` for the CSR,
  an optional peer dependency behind a lazy `import()`).
- `src/serve/config.ts` — `ServeOptions`, defaults, env overrides.
- `src/native/bundle.ts` — the release native bundle: the middleware
  Vite server, the `dev: false` build, hermesc, source-map composition.
- `src/native/chunks.ts` — client-reference discovery, the per-platform
  chunk build, the manifest, the seed.
- `src/native/release-ios.ts`, `src/native/release-android.ts` —
  archive/export and bundle/assemble.
- `src/native/device.ts` — device discovery and LAN host resolution.

**Config**

- `package.json` — `@peculiar/x509` in `peerDependencies` with
  `peerDependenciesMeta.optional`.
- `native/config.ts` — `url`, `serve`, `ios.teamId`,
  `ios.distribution`, `android.signing`, `serve.minimumBuild`.
- `vite/index.ts` — `withFlypath` destructures the new keys; the
  `server`-vs-`serve` error.
- `mail/config.ts` — `baseUrl` defaults to `url`.

**Native runtime**

- `runtime/native-config.ts` — `baseId`, `build`, `seeded`.
- `runtime/client-references.ts` — manifest lookup, the seed, the
  `409`/`426` paths.
- `runtime/native-root.tsx` — request `<path>.flight`; carry
  `baseId`; read `x-flypath-build`; the "update required" state.
- `runtime/native-prelude.ts` — `baseId`, `seeded`, production defines.
- `components/native/primitive.tsx` — relative `img src`.

**Vite**

- `vite/index.ts` — native environments in `build`, not only `serve`.
- `vite/native-env.ts` — mode-dependent defines.
- `vite/bundler.ts` — the base module set as a build output; the
  base/chunk overlap assertion.
- `vite/prerender.ts` — unchanged, but the build now also writes the
  compressed sidecars beside what it emits.

**CLI**

- `cli.ts` — `start`; `--release`, `--device`, `--host` on `ios` and
  `android`; `--platform` on `build`; the deploy checklist print.

**Templates**

- `templates/ios/App.xcodeproj/project.pbxproj` — the `Bundle/` group;
  signing allowed in Release; `INFOPLIST_FILE` per configuration.
- `templates/ios/App/Info.plist` + new `Info.debug.plist`.
- `templates/ios/App/AppDelegate.swift` — `__FLYPATH_DEV_HOST__`.
- `templates/android/app/build.gradle.kts` — `debuggableVariants`,
  release signing, R8, the flypath keep rules.
- `templates/android/app/src/main/AndroidManifest.xml` — cleartext out.
- `templates/android/app/src/debug/AndroidManifest.xml` +
  `res/xml/network_security_config.xml` — new.
- `templates/android/app/src/main/kotlin/…/MainApplication.kt` —
  `useDevSupport = BuildConfig.DEBUG`.
- `cpp/FlypathHermesRuntime.cpp` — sample profiling behind a flag.

**Example**

- `example/vite.config.ts` — `url`, a `serve` block with `cluster` and
  a staging-directory `acme` stanza commented for reference.
- `example/.gitignore` — `.flypath/`, `android/keystore.properties`.

## Tests

- `test/serve/adapter.test.ts` — method, URL construction from socket
  vs forwarded headers, multiple `set-cookie`, HEAD, a POST body round
  trip through `Request.formData()`, abort on client disconnect.
- `test/serve/static.test.ts` — resolution order, the `x-flypath-*`
  bypass, path traversal (`..`, encoded, symlinks out of the root),
  ETag/304, ranges, encoding negotiation, the three cache classes.
- `test/serve/cluster.test.ts` — fork count, restart backoff, the
  restart-loop bail-out, drain semantics and the health flip.
- `test/serve/csr.test.ts` — a generated CSR verified with
  `openssl req -inform DER -verify -noout` for a single domain and for
  SANs, so a `@peculiar/x509` upgrade that changes the output is
  visible.
- `test/serve/acme.test.ts` — the full order flow against a stub
  directory (nonce handling, `kid` after `newAccount`, key
  authorization, polling, retry on `badNonce`), and a renewal decision
  table over not-after dates.
- `test/native/chunks.test.ts` — the reference key matches
  plugin-rsc's for a known relative id; a chunk contains no module the
  base has; the manifest round-trips; a `baseId` change is detected.
- `test/native/release.test.ts` — the prelude under `dev: false` has
  `__DEV__ = false`, the configured `url` and a `baseId`; a release
  build with no `url` fails with the key named.

The end-to-end acceptance is not unit-testable and is written down as a
checklist in phase 7 instead: it needs a domain, two app stores and two
physical devices.

## Phases

### Phase 1 — the server, standalone

`src/serve/{index,adapter,static,config}.ts` and `flypath start`
single-process. No cluster, no TLS. `serve` and `url` in the config.

Acceptance: `flypath build && flypath start` serves the example on
`http://localhost:3000` — documents, flight payloads, server actions
with cookies, the prerendered `/about` and its `.flight` read off
disk, `/assets/*` immutable, a 404 rendering the not-found route.
`curl -I` shows the right cache class for each of the three kinds.
nginx in front, proxying to it, behaves identically.

### Phase 2 — cluster and shutdown

`serve/cluster.ts`, the `SIGTERM` drain, the health endpoint, the
access log.

Acceptance: eight workers answer; killing one is replaced; a worker
that cannot boot fails the process instead of looping; `SIGTERM`
finishes in-flight requests and flips health to 503 first. A second
checkout running `flypath work` against the same `dist/` drains the
queue while the web cluster serves, and neither knows about the other.

### Phase 3 — the native release bundle

Native environments in `build`; mode-dependent defines; `url` and
`baseId` in the prelude; hermesc; composed source maps;
`flypath build --platform`.

Acceptance: `dist/native/ios/main.jsbundle` is bytecode, is smaller
than the dev bundle, and evaluates in a standalone `hermes -exec`
smoke check the same way plan 1 phase 3 demanded of the first bundle.
A build with no `url` fails with the key named.

### Phase 4 — chunks, the manifest, the seed

Client-reference discovery and the key assertion against
`clientReferenceDeps`; the per-platform chunk build; the manifest and
the immutable files; the seed in the base bundle; the loader's
manifest/seed path; `x-flypath-build` on every flight response.

Acceptance: the example's client components render on a device with
**zero** chunk requests; changing one client component and redeploying
the server (without rebuilding the app) makes exactly that one chunk
fetch and the rest stay seeded.

### Phase 5 — skew

`baseId` on the wire, the `409` and `426` answers,
`serve.minimumBuild`, the skew report, the "update required" screen.

Acceptance: an app built against an older base keeps rendering every
seeded screen, reports skew once, and turns an unresolvable reference
into a named error; with `minimumBuild` set above it, it shows the
update screen instead. TODO's "Skew" is struck.

### Phase 6 — the release apps, and the lockdown

Signing on both platforms; the iOS `Bundle/` folder, archive and
export; Android `debuggableVariants`, R8, keystore and `bundleRelease`;
`useDevSupport = BuildConfig.DEBUG`; both plists, both manifests, the
network security config; sample profiling behind a flag.

Acceptance: `flypath ios --release` produces an `.ipa` that installs
via TestFlight; `flypath android --release` produces an `.aab` Play
accepts; `aapt2` finds no cleartext flag and `plutil` finds no ATS
dictionary; the release Android build has no dev menu.

### Phase 7 — devices, and the example earns it

`native/device.ts`, `--device`/`--host` on both commands, the LAN host
through all three consumers, `devicectl` install and launch,
`adb -s` with the reverse fallback. The example gets the `serve` block
and the ignore file.

Acceptance, as one pass: the example deployed to a real host over
Let's Encrypt, `flypath ios --device` and `flypath android --device`
running the dev loop against a laptop on the same Wi-Fi, and release
builds of both apps on those same two devices driving the deployed
server — navigation, forms, cookies, jobs, mail, the `"use native"`
camera and the prerendered page.

## Key decisions

- **One `url`, not three.** The public origin is a property of the
  application, not of a platform. `mail.baseUrl` and the native
  `serverUrl` both derive from it, and `FLYPATH_URL` is how one
  repository builds staging and production.
- **The server is in the framework, and it is standalone.** "Put nginx
  in front" is an optimisation, not a prerequisite, so the static
  layer, the cache policy and TLS all live here. The handler stays a
  plain `Request → Response` so anyone who wants a different host has
  the seam already.
- **`node:cluster`, and `cluster: false` is first-class.** The primary
  is the natural owner of the things that must happen once — ACME and
  graceful shutdown — and one process per container is what
  orchestrators want.
- **The production server does not run jobs.** A worker host is sized,
  scaled and restarted differently from a web host, and it is usually a
  different host entirely. `flypath work` already loads the production
  artefact and `flypath dev` already runs a worker for the dev loop, so
  there is nothing for `flypath start` to add except a way to get it
  wrong.
- **The ACME protocol is hand-written; the CSR is not.** Every library
  that would own the whole thing is either AGPL (Auto Encrypt, and its
  engineering is the best of them), abandoned (the `@root`/greenlock
  line), or 48–54 packages for `axios` and `node-forge`; and none of
  them removes the wiring, because the challenge route, the storage and
  the "only the primary does this" rule reach into a server flypath
  already owns. `@peculiar/x509` removes the one part with real
  downside risk. It is opt-in and it can never take down a listener
  that is already serving.
- **The release native bundle is the dev bundler with `dev: false`.**
  metro-runtime's registry, the Babel quarantine and the lazy-require
  layer are runtime contracts, not dev conveniences. Metro does not
  tree-shake either; the win is Hermes bytecode.
- **Chunks are seeded in the binary and content-addressed on the
  server.** Inlining alone freezes client components at build time and
  breaks the framework's own claim; fetching alone pays a round trip
  per component on a cold launch. The seed makes the common path free
  and the fetch makes the uncommon path correct.
- **The compatibility contract has a name.** `baseId` is EAS's
  `runtimeVersion` and CodePush's app-version pin, computed from the
  thing that actually matters — the base bundle's module set — and
  failing loudly instead of half-working.
- **The base bundle is bytecode; chunks are source.** HBC cannot be
  `eval`'d, and a byte-buffer loader is a native module flypath could
  write but nothing needs yet. Seeding means the common path evaluates
  no source at all, which is what the HBC-for-chunks question was
  really about.
- **Signing configuration is a file in the overlay, not a value in
  `vite.config.ts`.** Plan 13's split, and it keeps a keystore password
  out of a file people commit. `ios.teamId` is the one scalar, because
  for most projects it is the only setting.
- **The static layer never runs for a request with an
  `x-flypath-*` header.** One rule keeps prerendered files from
  reaching a native client, and moving native onto `.flight` paths
  means the rule almost never has to fire.
- **Release strips the dev loop rather than configuring it off.** No
  dev menu, no packager URL, no cleartext exception, no arbitrary
  loads, and a debug variant that carries all four.

## Not in this plan

- **Uploading to Google Play.** Needs the Play Developer API and a
  service account. The `.aab` is produced and the path is printed.
- **A traced, self-contained deploy artefact** in the shape of Next's
  `output: "standalone"`. `flypath build` prints the checklist instead.
  Additive later.
- **HBC chunks.** Needs a byte-buffer entry point on flypath's own
  Hermes runtime. The seam is `cpp/FlypathHermesRuntime.cpp` and the
  reason to build it is a measurement nobody has taken.
- **Retaining chunks for more than one build.** The URL shape
  (`<key>-<hash>.bundle`, immutable, plus a per-build manifest) is
  already what a multi-build retention policy needs; keeping the last
  K manifests and their chunks so older binaries can still fetch new
  code is a deployment policy, not a framework feature, until someone
  needs it.
- **TLS-ALPN-01 and DNS-01.** HTTP-01 covers a server that already
  owns port 80. DNS-01 is what wildcard certificates need and it needs
  a provider API per registrar.
- **OCSP stapling, HSTS preload, session resumption tuning.** Real, and
  each is a line of configuration once someone asks.
- **A dev-time throw for `query()` in a client component on a
  prerendered page.** Still plan 17's, still small, still separable.
- **Deep-link URL registration.** `CFBundleURLTypes` and an
  `<intent-filter>` with the app's scheme, plus universal links and app
  links with their association files. It becomes reachable once there
  is a release build and a server to host `apple-app-site-association`
  — which this plan creates — but it is its own surface with its own
  verification story.
- **Unifying logging.** The access log here is a `console.log` behind a
  format option. The framework-wide logging TODO stays open.
- **Zero-downtime phased restart** (Puma-style, workers replaced one at
  a time in place). `SIGTERM` plus a health endpoint is what a rolling
  deploy actually uses.
- **`reusePort` instead of a cluster primary.** A one-line change on
  Linux when it is worth measuring.

## Risks / open questions

- **The ACME protocol layer is still the newest code in the server**,
  even with the CSR delegated. The failure modes left are stateful
  rather than byte-level — a nonce not carried forward, `kid` used
  before `newAccount` returns, an order polled to the wrong terminal
  state — and they surface as a retry loop against a rate-limited
  service. Mitigation: the stub-directory test covers each of those
  transitions, and the staging directory is what the example
  configures.
- **`@peculiar/x509` leans on Node's WebCrypto**, which is where the
  P-256 keys have to come from as a result — a second key-handling path
  beside `node:crypto`, in the same file. Keeping both in
  `serve/acme.ts` and nowhere else is the containment.
- **ACME rate limits.** 50 certificates per registered domain per week
  and a much tighter limit on failed validations. A restart loop that
  re-requests on every boot would burn a week's allowance in minutes.
  Mitigation: the certificate is on disk with its not-after date, the
  renewal decision is a pure function of that date, and issuance
  happens on a timer in the primary — never on a request, never on a
  worker boot.
- **`baseId` might be too strict.** It is a hash over the base
  bundle's module set, so an upgrade that only adds a module the
  chunks never touch still invalidates it. The honest failure is a
  fetch that returns `409` and a seeded app that keeps working, which
  is survivable but noisier than it needs to be. Recording the module
  set per build and answering "is this chunk satisfiable by that base?"
  exactly is the refinement, and it is deliberately deferred.
- **A release build that changes a `"use client"` component's props
  contract** ships a new chunk to an old binary. That is correct — the
  chunk is the new code — but the _server component_ calling it is also
  new, so the pair is consistent. The genuinely dangerous case is a
  client component that imports a `"use native"` binding the binary
  lacks, which the existing native manifest hash already catches
  (`runtime/native-bindings.ts:25`); the two skew signals must be
  reported together or a developer will chase the wrong one.
- **`setup-apple-spm.js` against a second synchronized folder.** Plan
  13's risk, one more time: RN's pbxproj edits are targeted regex, and
  adding a `Bundle/` group is the kind of thing that could confuse
  them. It is the first thing to check in phase 6, and the fallback is
  an explicit file reference plus a copy-files build phase.
- **R8 on a Fabric app.** `__FLYPATH_VIEW_NAMES__` is a list of strings
  resolved reflectively, and generated TurboModule registration goes
  through JNI. The keep rules have to be right or the release build
  fails at runtime, on a device, with a class-not-found from native
  code. Mitigation: phase 6 acceptance runs the _release_ APK on a
  device before the `.aab` is considered done, and `isMinifyEnabled`
  has an escape hatch in `app.gradle.kts` (plan 13, phase 5).
- **Hermes `eval` in a release runtime** is what the whole chunk story
  rests on. It is on by default and flypath owns the `RuntimeConfig`
  (`cpp/FlypathHermesRuntime.cpp:57`), so the risk is a future RN
  change, not today's behaviour. The seed means a release app with no
  new chunks evaluates no source at all, which also narrows the App
  Store 3.3.2 exposure plan 3 flagged: server-delivered JS is the
  update path, not the boot path.
- **`x-flypath-build` on every response** is a header on the hot path
  and a cache key for anything in front. It must be `Vary`-safe:
  it is a response header only, never a request header, so it never
  splits a cache — but a CDN configured to strip unknown headers would
  silently disable deploy detection, and the manifest re-fetch would
  never fire.
- **The LAN address guess.** `os.networkInterfaces()` on a machine with
  a VPN, Docker bridges and two Wi-Fi adapters picks the wrong one
  regularly. `--host` is the answer and the CLI prints which address it
  chose, every time, rather than only when it fails.
