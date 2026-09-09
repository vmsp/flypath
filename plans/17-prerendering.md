# Flypath — prerendering

## Goal

A page whose render does not depend on the request should be rendered
once, during `flypath build`, and served as a file — by the app server,
or by a CDN with nothing behind it.

Milestone: `route("about", () => import("./about.tsx"), { prerender: true })`
makes `flypath build` write `dist/client/about/index.html` and
`dist/client/about.flight`. A static host pointed at `dist/client`
answers `GET /about` with the finished document. Clicking a link to
`/about` in the running app fetches `about.flight` and navigates without
the server rendering anything. Adding `cookies()` to the page fails the
build with a message that names the route, and adding a middleware over
it fails the build before anything renders at all.

## What is missing today

1. **Every response is rendered.** `handler`
   (`runtime/server-entry.tsx:223`) matches, runs middleware, renders
   RSC and — for a document — pipes that through SSR, on every request.
   Nothing is reused between two requests and there is nowhere a render
   result could be kept.
2. **The build emits no pages.** `flypath build` (`cli.ts:171`) runs
   `builder.buildApp()` and stops. `dist/` holds `client/`, `rsc/` and
   `ssr/`: a handler and its assets, no HTML.
3. **The flight URL is a query param.** `router-web.tsx:126` asks for
   `/about?__flight=1`. A static host keys on the path and would answer
   that with the document. Today's payload URL is not a file and cannot
   become one.
4. **Nothing separates a request-dependent render from the rest.**
   `cookies()`, `headers()`, `query()` and `context()` read the request
   store and work in any server component. There is no mode in which
   they are illegal, and no way for a route to declare that it does not
   use them.
5. **Native's first screen is hardcoded.** `initialRouter("/")`
   (`runtime/native-root.tsx:145`) opens the app on `/`, always.

## Field notes — prior art

**Next.js, pages router.** `getStaticProps` + `getStaticPaths` opted a
page in, `fallback: false | true | "blocking"` decided what happened to
a path that was not listed. The unit was the page, the constraint was
"there is no request object here", and it was enforced by not passing
one.

**Next.js, app router (13–15).** Static became the *default* and you
fell out of it by touching a dynamic API: `cookies()`, `headers()`,
`searchParams`, an uncached `fetch`. At build time those threw a
`DynamicServerError` that the framework caught to mark the route
dynamic; with `dynamic: "error"` the throw reached you. Route segment
config (`dynamic`, `revalidate`, `dynamicParams`, `fetchCache`) let you
force the decision either way. Two lessons: **implicit opt-out is hard
to reason about** — people could not tell why a route went dynamic —
and **the enforcement mechanism is a throw from the request-scoped
accessor**, which is cheap and exact.

**Next.js 16, cache components.** The segment config is gone. A route
is prerendered as far as it can be; work that cannot complete at build
time must sit behind `<Suspense>` (streams at request time) or inside
`use cache` (joins the shell). Uncached request data with no boundary
is a build error naming the route. This is partial prerendering: one
route, a static shell plus dynamic holes. It is the right long-term
shape and it is a large amount of machinery — a second render pass, a
cache with lifetimes and tags, a resume protocol on the client.

**React Router v7/v8.** `prerender: true | string[] | (async fn)` in
the config, not on the route. The build makes real `new Request()`
objects and runs them through the app, then writes `[url].html` for the
document and `[url].data` for client navigations. `ssr: false` narrows
what a prerendered route may declare (no `headers`, no `action`). The
two-files-per-path output and the synthetic-request build loop are
directly worth copying.

**SvelteKit.** `export const prerender = true` on the route, a crawler
that starts at the root and follows `<a href>` to discover pages,
`entries()` to enumerate params. The constraints are stated bluntly:
no `url.searchParams`, no form actions, no per-visitor data, and an
error when two routes want to write the same file. Its `handle` hook
*does* run during prerendering, against a synthetic request — which is
where its "you cannot read cookies here" errors come from.

**Waku.** `getConfig()` per route returning `{ render: "static" }`, on
an RSC pipeline shaped like this one: the build writes the flight
payload to a file and the HTML beside it.

What this plan takes: **opt in on the route** (SvelteKit, Waku),
**two files per path, built by running synthetic requests through the
real handler** (React Router), **throw from the request-scoped
accessor** (Next), and **name the route in the error** (Next 16).
What it leaves: crawling, partial prerendering, and any form of cache
with a lifetime.

## Options considered

### Opt in, or static by default

Next's app router made static the default and inferred the opt-out.
That works when the framework can see every input to a render, and it
produced years of "why is my route dynamic?". Flypath's inputs are
wider than Next's — a middleware chain, `context()`, the platform, a
database — and the answer would be "almost nothing is static". Opt in,
per the request: `prerender: true`.

### The unit is a route, not a path

React Router takes a list of paths, which is what makes
`generateStaticParams`-style enumeration natural. Flypath's route
options are already the place where per-route behaviour is declared
(`safeArea`, `presentation`, `prefetch`, `revalidate`), they are
already extracted statically into the manifest, and the client already
reads them. `prerender: true` costs nothing to plumb. The consequence
is that **v1 prerenders only routes with no `:params`** — there is no
place to put the list of ids yet. `entries()`/`generateStaticParams` is
a later, additive option (see "Not in this plan").

### Where the payload lives: query param or path

A prerendered route needs two artifacts: the document, and the flight
payload the client fetches when it navigates to that route from
somewhere else. The document is already path-addressed. The payload is
not: `?__flight=1` is invisible to every static host.

So the flight payload moves to a path. Two shapes were considered:
a prefix (`/_flight/about`) and a suffix (`/about.flight`). The suffix
wins on hosting — an extension is something a static host can be told
about — and it matches `.rsc` (Next) and `.data` (React Router).

Then: only for prerendered routes, or for every route? Only-for-some
means the client has to look the route up in the manifest before it can
build a URL, and there are two URL shapes for one thing. Uniform means
`request()` rewrites the path and stops thinking. Uniform also deletes
`FLIGHT_PARAM` and `isInternalParam` — a reserved query param that
`hrefOf()` and `searchOf()` currently have to filter out of user search
params. **Every web flight request becomes `<path>.flight`.**

### Middleware

This is the constraint that decides how useful the feature is, so the
three options are worth stating.

**Run it at build time** against a synthetic request, as SvelteKit
does. The example's root `request` middleware calls `userFromSession()`
→ `cookies()` and would throw. Every app with a root middleware learns
about the rule as a stack trace from inside its own session code.

**Run it at request time, cache only the render.** This is Next's
model: middleware is an edge function in front of the static file, so
`auth` still guards a prerendered route. It is the model that scales,
and it is a lie the moment the file is served from a CDN with no origin
— which is the deployment this feature exists to enable. It also means
a prerendered render may not read `context()`, so half the constraint
is needed anyway.

**Forbid it.** A route with any middleware in its chain — including one
declared on `routes()` — may not be prerendered, and the build says so
before rendering anything. The artifact is then unconditionally safe to
serve from anywhere, the rule is one sentence, and there is no
half-run middleware and no partial side effects at build time.

Taken: **forbid it.** The cost is real and should be stated plainly: a
middleware on `routes()` makes the whole app unprerenderable, and the
fix is to move it down so that guards wrap the app and not the site.
In the example that means `{ middleware: [request] }` moves from
`routes()` onto the `stack()` inside the layout, which is where it
belonged anyway.

### The database

The premise in the request was that a server component which reads the
database cannot be prerendered. It can, and it is most of the point:
reading content at build time is what a prerendered docs page, blog
post or catalogue page *is*. React Router runs loaders at build time,
SvelteKit runs `load`, Next 16 caches `db.query` under `use cache`.

What actually breaks is not the database, it is the request. A
per-visitor query needs `cookies()` or `params()` or `query()` to build
its predicate, and all three are already forbidden — so the illegal
queries are unreachable by construction. Reads are allowed.

Three consequences are accepted and documented rather than prevented:
`flypath build` needs `DATABASE_URL` and a reachable database when a
prerendered route queries; the data is frozen until the next build; and
N prerendered pages run N queries at build time.

Two things are prevented: **writes** — `Insert`, `Update` and `Delete`
throw during a prerender, because a build that mutates the database is
a footgun with no legitimate use — and **side effects** generally:
`sendMail()`, `jobs()` and `cron()` throw for the same reason. Raw
`sql\`\`` is not policed; it cannot be.

### Client components only?

Rejected, and worth being explicit about. A route restricted to client
components prerenders to an empty shell plus a hydration bundle: the
HTML would contain no content, which is the one thing prerendering is
for. The correct restriction is not *where* a component runs but *what
it reads*. A server component that reads the filesystem, the database,
or nothing at all is exactly what should be prerendered; a client
component that reads `query()` is not made safe by being a client
component (see below — it is the one hole this plan leaves open).

### Native: exclude the route, or configure the launch route

`prerender: true` says "the web build has a file for this route". It
does not remove the route from the server, and the server can still
render it for an iOS request like any other. That is worth keeping:
prerendering stays an optimisation, never a change in what exists.

What is real is that the *page* is usually web-shaped — a landing page
at `/` while the app should open on the feed. So the addition is not a
platform filter but a launch route: `routes({ launch: "/feed" }, …)`,
defaulting to `"/"`, carried in the manifest, read by
`initialRouter()`. And because opening a native app on a prerendered
marketing page is almost always a mistake, **the build fails when the
route matching `/` is prerendered and `launch` is unset** — setting
`launch: "/"` is how you say you meant it.

## Shape

```
app/routes.ts
  route("about", …, { prerender: true })
        │
        ├─ vite/route-extract.ts ─── validates, and puts
        │     prerender: true into virtual:flypath/route-manifest
        │
        ├─ build (vite/prerender.ts, buildApp order:"post")
        │     imports dist/rsc/index.js and calls prerender(["/about"])
        │        → GET /about        → dist/client/about/index.html
        │        → GET /about.flight → dist/client/about.flight
        │
        ├─ server (runtime/server-entry.tsx)
        │     renders /about in prerender mode, on demand, identically —
        │     for native, for a cache miss, for dev
        │
        └─ client (runtime/router-web.tsx)
              navigates by fetching /about.flight, which is a file
```

The invariant the whole design rests on:

> A prerendered render reads nothing about the request. So it can be
> run at build time, or on demand, or twice, and the answer is the
> same. The file is a cache of a pure function; it is never the only
> way to get the page.

## The API

### `prerender`

```ts
// router/types.ts, in RouteOptions
  /**
   * Render this route once during `flypath build` and serve the result
   * as a file. Nothing about the request is readable while it renders —
   * no cookies, headers or query — and no middleware may run over it,
   * so every visitor gets the same page. Web only; native renders it on
   * demand like any other route.
   */
  prerender?: boolean;
```

```ts
route("about", () => import("./about.tsx"), { prerender: true }),
index(() => import("./landing.tsx"), { prerender: true }),
```

### `launch`

```ts
// router/types.ts
export type RootOptions = MiddlewareOptions & {
  /**
   * Where the native app opens, `"/"` unless set. Web opens whatever URL
   * was visited, so this moves the app's first screen only — set it when
   * the index route is a web page the app should not start on.
   */
  launch?: string;
};
```

```ts
routes({ launch: "/feed" }, [ … ]);
```

`launch` is typed `string`, not `Href`. `Href` resolves through
`Register`, which is declared from the same file that calls `routes()`,
so referring to it here is circular. The build validates it instead,
which it has to do anyway.

### What a prerendered render may not do

| Called during a prerender | What happens |
| --- | --- |
| `cookies()`, `cookies.set/clear` | throws |
| `headers()`, `headers.set/delete` | throws |
| `query()`, `query.all()` | throws |
| `navigate()`, `navigate("not-found")` | throws |
| `sendMail()` | throws |
| `jobs()`, `cron()` | throws |
| `db().into(…).insert/update/delete` | throws |
| `db()` reads | allowed — frozen at build time |
| `params()` | allowed, always `{}` (the pattern has none) |
| `platform()`, `isNative()`, `isIos()` | allowed, `"web"` at build time |
| `isPrefetch()` | allowed, always `false` |
| `context()` | allowed; only ever sees its fallback |
| `context.set()` | already throws outside middleware |
| a `"use server"` action, from the page | allowed; it runs at request time |

The last row is the deployment caveat worth stating in one line: a form
on a prerendered page still POSTs to the server, so a page with actions
is prerenderable but not *serverless*.

Prerenderability is a property of the whole rendered tree, not of the
leaf: every `layout()` above the route and every `branches()` chrome
around it renders in the same mode and under the same rules.

## How it works

### Prerender mode

`RequestInfo` (`runtime/platform.ts:9`) gains `prerender: boolean`, set
by `handler` from the matched route's options — not from the
environment. So a prerendered route renders under the same rules
everywhere: in the build, in `flypath dev`, on the production server,
and for a native request. One rule, no dev/prod skew, and the on-demand
render is guaranteed to match the file.

`isPrerendering()` joins `platform.ts` beside `isPrefetch()`, reading
`getRequest()?.prerender ?? false`. The seven accessors above call it
and throw. The messages follow the house shape — what happened, why it
cannot work, what to do instead:

```
flypath: cookies() was read while prerendering /about; a prerendered
page is rendered once and served to everyone, so it cannot depend on
who is asking — drop prerender from the route, or move the part that
needs the visitor into a "use client" component
```

```
flypath: /about has prerender: true but the middleware request() runs
over it (declared on routes()); a middleware exists to make a response
depend on the request, and a prerendered response is a file — move the
route out from under it, or drop prerender
```

### The flight URL

New `shared/flight.ts`:

```ts
export const FLIGHT_SUFFIX = ".flight";
export function flightPath(pathname: string): string;   // "/" -> "/index.flight"
export function documentPath(pathname: string): string; // inverse
export function isFlightPath(pathname: string): boolean;
```

- `router-web.tsx` `request()` rewrites the pathname instead of setting
  a search param. The `SCREEN_HEADER` and `PREFETCH_HEADER` are
  unchanged; they are headers and stay orthogonal.
- `server-entry.tsx` `handler()` strips the suffix off `url.pathname`
  before anything else looks at it, and folds the result into
  `wantsFlight` where `url.searchParams.has(FLIGHT_PARAM)` is today
  (`:238`). Everything downstream — matching, `hrefOf`, the
  `LOCATION_HEADER`, redirect targets — sees the document path.
- `shared/params.ts` loses `FLIGHT_PARAM` and `isInternalParam`, and
  `path.ts`'s `hrefOf`/`searchOf` lose the filter that used them.

Nothing on native changes: it asks for the plain path and gets a
payload because of `PLATFORM_HEADER`.

### The build step

`vite/prerender.ts`, a plugin with `buildApp: { order: "post" }` so it
runs after `@vitejs/plugin-rsc`'s own `buildApp` has built all three
environments:

1. Read the manifest from the `flypath:routes` plugin's `api` — the
   same seam `cli.ts` already uses to read `CONFIG_PLUGIN`'s options.
2. `paths = manifest.routes.filter(r => r.options.prerender)`, mapped
   to their patterns (which are literal paths; params are rejected at
   validation).
3. `import(pathToFileURL(dist/rsc/index.js))` and call its exported
   `prerender(paths)`. This is what `flypath work` already does with
   the same file, so the "run the built server in the build process"
   move is not new.
4. Write the files, log one line each, `closePools()`.

`runtime/prerender.ts` holds the loop, and `server-entry.tsx` exports
`prerender = (paths) => prerenderPages(handler, paths)` beside its
existing `export { work }` — a function, not a magic header, so there
is no request shape a real client could forge into build mode.

Per path it makes two requests through the real handler:

```ts
const document = await handler(new Request(`http://prerender.invalid${path}`));
const flight = await handler(new Request(`http://prerender.invalid${flightPath(path)}`));
```

Two renders rather than one, because the document response inlines its
payload through `injectRSCPayload` and never exposes the bytes
separately. That is affordable precisely because the render is pure:
no double side effects are possible. A status other than 200 fails the
build — a prerendered route that redirected, 404'd, or threw is a bug
in the route, not a case to handle.

### What is written

```
/                 → dist/client/index.html          dist/client/index.flight
/about            → dist/client/about/index.html    dist/client/about.flight
/legal/privacy    → dist/client/legal/privacy/index.html
                    dist/client/legal/privacy.flight
```

`dist/client` is the directory a CDN or static host is pointed at, and
it already holds the hashed assets the pages reference. The document
lands at `<path>/index.html` because that is what every static host
resolves a directory request to; the payload lands beside it at the
exact URL `router-web.tsx` will ask for.

The build fails if two routes want the same file, or if the file
already exists from the client build (`/assets`, say).

### Dev

No files are written and nothing is cached. `flypath dev` renders a
prerendered route on demand, in prerender mode, for both the document
and the `.flight` URL. So the constraint is enforced from the first
reload rather than at deploy time, which is the entire dev-time value
of the feature — and the reason prerender mode is keyed on the route
rather than on the build.

Changing `app/routes.ts` already invalidates the manifest and
full-reloads (`vite/routes.ts:58`); a new validation error surfaces the
same way the existing ones do.

### Validation, at build

All of it in `routeManifest()` (`vite/route-extract.ts:272`), after
`flatten()`, so every message is produced in one place and one shape.

A route with `prerender: true` is rejected when:

- **its pattern has a `:param`** — there is nowhere to declare the
  values yet;
- **any middleware runs over it**, its own or an ancestor's;
- **`presentation: "modal"`** — a modal navigation sends
  `SCREEN_HEADER` and gets a different, container-scoped payload, and
  one file cannot be two payloads;
- **a path segment is `index`, or ends in `.flight`** — both collide
  with the output layout;
- **it is the `notFound()` route** — see "Not in this plan".

Plus, once per tree: `launch` must name a declared, param-free,
non-prerendered path; and if the route matching `/` is prerendered,
`launch` must be set.

The middleware check needs something the build does not have today:
`route-extract.ts` deliberately strips `middleware` from options
(`:114`) because it holds runtime functions. It does not need the
functions — only the fact and the name, both of which are in the AST.
So `interpret()` synthesizes one placeholder middleware per declared
identifier, named after it:

```ts
const declared = (name: string): Middleware =>
  ({ [name]: (next: Next) => next() })[name] as Middleware;
```

`flatten()` then threads them into `FlatRoute.middleware` exactly as it
threads the real ones, `routeManifest()` reads `.name` off them for the
error message, and `manifestRoute()` — which copies only
`id`/`pattern`/`options`/`placement` — keeps them out of the shipped
manifest.

### Native

`RouteManifest` gains `launch?: string`. `initialRouter("/")` becomes
`initialRouter(manifest.launch ?? "/")` and nothing else on native
changes: a prerendered route is still reachable by deep link and still
rendered by the server when asked for.

## What changes

**New**

- `src/shared/flight.ts` — the suffix and the path math, importable
  from the client, the server and the build.
- `src/runtime/prerender.ts` — `prerenderPages(handler, paths)`.
- `src/vite/prerender.ts` — the `buildApp` plugin that writes the files.

**Router**

- `router/types.ts` — `RouteOptions.prerender`; `RootOptions` with
  `launch`.
- `router/config.ts` — `routes()` takes `RootOptions`, carries `launch`
  on the tree.
- `router/manifest.ts` — `RouteManifest.launch`.
- `router/server.ts` — `query()` throws in prerender mode.
- `router/navigate-server.ts` — `navigate()` throws in prerender mode.
- `router/path.ts`, `shared/params.ts` — `FLIGHT_PARAM` and
  `isInternalParam` deleted.

**Runtime**

- `runtime/platform.ts` — `RequestInfo.prerender`, `isPrerendering()`,
  `headers()` guards.
- `runtime/cookies.ts` — guards.
- `runtime/server-entry.tsx` — strip the flight suffix; set
  `prerender` on the request info from the matched route; export
  `prerender`.
- `runtime/router-web.tsx` — `request()` builds the `.flight` path.
- `runtime/native-root.tsx` — launch from the manifest.

**Elsewhere**

- `mail/index.ts`, `jobs/enqueue.ts`, `db/mutate.ts` — guards.
- `vite/route-extract.ts` — `launch` parsing, declared-middleware
  placeholders, all prerender validation.
- `vite/plugins.ts` — register `prerender()`.
- `cli.ts` — the build closes pools once prerendering is done.

**Example**

- `{ middleware: [request] }` moves from `routes()` onto the `stack()`
  inside the layout, so the site can have pages the app's guards do not
  wrap.
- `app/about.tsx`, a real page with no request state, added as a child
  of `layout()` beside the stack with `{ prerender: true }`, and linked
  from the not-found page so a human can reach it.
- `/explore` stays dynamic, and the plan says why: it is inside the
  tabs, under `request`. Prerendering it would mean pushing that
  middleware down onto the routes that actually need a session — the
  right change for a real app, and too much noise for this one.

## Tests

- `test/router/flight.test.ts` — `flightPath`/`documentPath` round trip,
  including `/` ↔ `/index.flight` and a nested path; `isFlightPath` on
  a route that merely contains a dot.
- `test/router/prerender.test.ts` — `routeManifest(parseRouteTree(…))`
  over source fixtures: `prerender: true` reaches
  `ManifestRoute.options`; each of the six rejections throws with its
  message; `launch` reaches the manifest; an unset `launch` under a
  prerendered `/` throws; a `launch` pointing at a prerendered or
  unknown path throws. These are pure functions over a string, which is
  what makes them worth writing.
- `test/router/prerender-files.test.ts` — path → output files, and the
  collision check.
- Milestone, by hand and then in the example's build: `pnpm build` in
  `example/` writes the two files; `python -m http.server` over
  `example/dist/client` serves `/about` with the heading in the HTML
  and no server running; `flypath dev` still renders `/about`, and
  adding `cookies()` to it fails the reload with the named error.

## Phases

### Phase 0 — the flight URL moves to a path

`shared/flight.ts`; `router-web.tsx` asks for `<path>.flight`;
`server-entry.tsx` strips it; `FLIGHT_PARAM` and `isInternalParam`
deleted. Nothing is prerendered yet and the app behaves exactly as
before — this is the protocol change on its own, so that if a
navigation breaks it is obvious why.

### Phase 1 — the option and its rules

`prerender` and `launch` in the types and in `routes()`; the declared
middleware placeholders; every validation in `routeManifest()`;
`prerender` reaches the manifest. `prerender.test.ts` passes. The
option exists, is checked, and does nothing.

### Phase 2 — prerender mode

`RequestInfo.prerender`, `isPrerendering()`, and the seven guards.
`flypath dev` now refuses a prerendered route that reads the request,
on both URLs. Still no files.

### Phase 3 — the build writes files

`runtime/prerender.ts`, the `prerender` export, `vite/prerender.ts`,
the plugin registration, the build log lines and `closePools()`.
`flypath build` writes `dist/client/about/index.html` and
`about.flight`, and a static host serves them.

### Phase 4 — native launch

`RouteManifest.launch`, `initialRouter(manifest.launch ?? "/")`, and
the "`/` is prerendered but `launch` is unset" build error.

### Phase 5 — the example earns it

The middleware moves down, `/about` arrives and is prerendered, the
milestone runs end to end on web, iOS and Android — the app opening on
`launch` while the browser opens on the prerendered index.

## Key decisions

- **Opt in on the route, not inferred from what the render touched.**
  Next spent two major versions teaching people why a route "went
  dynamic". `prerender: true` is a claim the developer makes and the
  framework checks; every failure names the route and the call.
- **Prerender mode is a property of the route, not of the build.** The
  same rules apply in dev, in the build, on the server and for native.
  That is what makes "the file and the on-demand render are the same
  page" true, and it is what makes the constraint visible on the first
  reload instead of at deploy time.
- **The flight payload becomes a path, for every route.** A payload URL
  that only exists as a query param can never be a file. Making it
  uniform rather than prerender-only means the client never has to look
  a route up to build a URL, and it deletes a reserved query param that
  `hrefOf()` and `searchOf()` were filtering out of user search params.
- **No middleware over a prerendered route.** The alternative — run it
  at request time and cache only the render — is Next's, is better, and
  is a lie the moment a CDN serves the file with no origin behind it.
  This rule costs the example a restructure and buys an artifact that
  is safe to serve from anywhere, with no caveat attached.
- **The database is allowed; writes and side effects are not.** Reading
  content at build time is what prerendering is for, and the queries
  that would be wrong are already impossible because their inputs —
  cookies, params, query — are forbidden. `sendMail()`, `jobs()`,
  `cron()` and the mutation builders throw, because a build that sends
  mail is never what anyone meant.
- **Not "client components only".** That prerenders an empty shell,
  which is the one outcome with no value. The restriction is on what a
  component reads, not where it runs.
- **Prerendering never removes a route.** The server can always render
  it, which is what lets native ignore the feature entirely, lets dev
  skip the build step, and makes a missing file a performance problem
  rather than a 404.
- **Native gets a launch route, not a platform filter.** `launch` says
  where the app opens; the routes stay shared. The build error when `/`
  is prerendered and `launch` is unset exists because an app opening on
  a marketing page is a mistake nobody makes on purpose.
- **`launch` is a `string`.** `Href` is derived from `Register`, which
  is declared from the file that calls `routes()`. The build validates
  the path instead.

## Not in this plan

- **Dynamic params.** `route("p/:id", …, { prerender: true })` needs a
  way to enumerate ids — SvelteKit's `entries()`, Next's
  `generateStaticParams`, React Router's `prerender` function. It is
  additive: an async `entries` on the route options, resolved by the
  build step, feeding the same loop. The validation error for a
  `:param` today is the placeholder for it.
- **Revalidation of a built page.** No ISR, no `revalidate: 60`, no
  `revalidatePath()`. A prerendered page is frozen until the next
  build. The natural next step is not ISR but the server serving the
  built file: `dist/prerender/` read by `handler` on a cache hit, with
  an invalidation call.
- **Partial prerendering.** A static shell with `<Suspense>` holes
  filled at request time is where this ends up if it keeps going, and
  it is a different project: a resume protocol, a second render pass,
  and a cache with lifetimes.
- **Prerendering `notFound()`.** `404.html` is a static-host
  convention worth having, but the fallback has no pattern, and a
  client navigation to an unknown URL has no file to ask for. Small
  and separable.
- **A crawler.** SvelteKit discovers pages by following links.
  Flypath's routes are declared, so there is nothing to discover.
- **Serving.** Flypath still has no `flypath start`. This plan writes
  files into `dist/client` because that is the directory a host is
  pointed at; what fronts the app server is the deployment's business
  until there is a story for it.
- **`query()` in a client component on a prerendered page.** The
  payload bakes `search: {}` into `RouteScope`, so `query("q")` returns
  nothing even when the URL has one. A dev-time throw on the client —
  `makeQuery` checking `matchManifest(pathname).options.prerender` — is
  the cheap fix and belongs with this feature; it is called out here
  because it is the one hole the server-side guards do not cover.
- **Policing `Date.now()`, `Math.random()`, `crypto.randomUUID()`.**
  Next flags all three. Here they silently freeze, which is a documented
  caveat rather than an error.
- **Build concurrency.** Paths render one at a time. React Router's
  `concurrency` option is the answer when a build is slow enough to
  care.

## Risks / open questions

- **A prerendered route that reads the database drifts.** The file is a
  snapshot; an on-demand render of the same route is a fresher one, so
  two visitors can legitimately see different content depending on
  which answered. This is ordinary SSG staleness, but it does dent the
  "the file and the render are the same page" invariant, and it is the
  strongest argument for the `dist/prerender/`-served-by-the-handler
  follow-up.
- **A build that hangs.** A component that suspends on something that
  never resolves turns `flypath build` into a hang rather than an
  error. A per-path budget with the path in the timeout message is
  probably worth having from the start.
- **Two renders per path.** Acceptable now; if it stops being so, the
  fix is for `prerenderPages` to render the payload once and call
  `handleSsr` on a replay of the bytes itself, which means lifting that
  pairing out of `dispatch`'s closure.
- **`import(dist/rsc/index.js)` inside the build process** mutates
  `__FLYPATH_STATE__` — the database pools, the job registry, the mail
  config — in the same process as Vite. `flypath work` already does
  this, but it does it in a process that then exits; here the build
  continues afterwards. `closePools()` is required, not optional.
- **The middleware rule may be too strict in practice.** If real apps
  keep hitting it for middleware that only logs, the relaxation is a
  declaration on the middleware itself — something like
  `middleware.static(fn)` — that says it contributes nothing to the
  response and may be skipped. That is a smaller change than it looks
  and can be added without moving anything decided here.
