# Flypath — middleware

## Goal

Give the route tree a place to run code before a request renders, and a
typed way for that code to hand values to the server components and server
actions underneath it. One function shape, declared in `routes.ts` next to
the route it guards, running on the server only, on all three platforms.

Milestone: `example/app/settings.tsx` and `/compose` sit behind an `auth`
middleware declared in `example/app/routes.ts`; a signed-out visit to
`/settings` answers 307 to `/login` on web and pops the push on native
without the settings module ever being imported; `/feed` renders with
`session()` reading the value the middleware set, with no session lookup
of its own.

## What is missing today

**No header is readable.** `RequestInfo` (`runtime/platform.ts:7`) carries
`pathname`, `params`, `search`, `platform`, `phase` — a routing summary.
The `Request` exists only as `handler`'s parameter
(`runtime/server-entry.tsx:179`) and nothing derived from it reaches the
store. So no server component can read a header, and nothing in the
framework can read a cookie. Every framework flypath is compared against
ships this before it ships middleware; flypath has neither.

**There is no response either.** `handler` builds `Response` objects at six
places with literal header bags (`server-entry.tsx:156`, `166`, `173`,
`222`, `290`, `300`). Nothing anywhere else in a request can contribute a
header, so `Set-Cookie` — the output half of every auth flow — is
unexpressible.

**Guards are per-page, hand-rolled, and after the fact.** The only way to
protect a route today is to start rendering it and call `navigate("/login")`
from inside the component. That is late (the module is loaded, the layout
chain is built, the render has begun), it is per-file (nothing enforces
that the next page added under `/settings` repeats it), and it cannot be
seen by reading `routes.ts`.

**Nothing can share a value across a request.** A layout and its page each
resolve the session independently. `React.cache()` deduplicates that within
one render, but it is scoped to the render, and it cannot express a value
that is _decided_ rather than _derived_ — a request id, an opened
transaction, a feature-flag snapshot — nor make one available to a server
action, which is not a render at all.

**Server components take no props**, and that is the fact that shapes this
whole plan. `renderMatch` does `createElement(Leaf)` with no props at all
(`runtime/router-server.tsx:89`). There is no argument slot to
thread a context bag through, the way React Router threads one into
`loader({ context })`. Anything a middleware wants to hand to a component
must arrive ambiently or not at all.

## Field notes — prior art

- **React Router 7** is the closest analogue and the design to beat.
  `middleware` is an array exported from a route module; the function is
  `({ request, params, context }, next)`; the chain runs parent-to-child
  and unwinds child-to-parent; short-circuiting is `throw redirect(...)`;
  `next()` is **optional** — omit it and the framework calls it for you —
  but must be called at most once, and on the server its return value is
  the `Response` you are expected to return. Context is `createContext<T>(default?)`
  plus `context.get`/`context.set` on a provider object that is _passed
  in_. It also needs a second, parallel `clientMiddleware`, and a
  documented hack — "add a `loader` to force middleware to run on client
  navigations" — because a client-side transition can otherwise skip the
  server entirely.
- **Next.js has walked away from the name.** `middleware.ts` is deprecated
  and renamed `proxy.ts` in 16; the docs say the rename exists because
  "the term middleware can often be confused with Express.js middleware",
  that the feature "is recommended to be used as a last resort", and that
  the team is "moving away from Middleware". It is one global file with a
  regex `matcher`, it cannot pass values to the render except through
  headers/cookies/rewrites ("you should not attempt relying on shared
  modules or globals"), and its own docs warn that Server Functions are
  POSTs to the page's route, so a matcher change "can silently remove
  Proxy coverage" — "always verify authentication and authorization
  inside each Server Function rather than relying on Proxy alone".
- **Astro** is the minimal shape: `onRequest(context, next)`, return a
  `Response` to stop or `next()` to continue, share values by mutating
  `context.locals`, compose with `sequence(a, b, c)`. Typing `locals` is a
  global `declare namespace App { interface Locals {...} }` — one flat bag
  for the whole app, no per-value types, no way to know which middleware
  filled which key.
- **SvelteKit** is the same shape one level up: `handle({ event, resolve })`,
  `event.locals`, `sequence()`. Its community's standing complaint is that
  `sequence` is strictly sequential and therefore a waterfall — the cost of
  the onion, paid on every request.
- **Hono** is the canonical onion: `(c, next)`, `await next()`, work after
  it runs in reverse registration order, `c.set`/`c.get` for values.
  Typing those values is the known wart — `ContextVariableMap` "adds types
  globally to all contexts, regardless of whether the middleware that sets
  the variable has actually run", so `c.get('user')` type-checks in
  handlers the middleware never ran for.
- **TanStack Start** is the most typed: `createMiddleware().server(({ next, context }) => next({ context: { user } }))`,
  where the context returned from `next()` is _merged_ and accumulates
  types down the chain, and middleware declare dependencies on other
  middleware with `.middleware([...])`. It pays for this with a builder
  chain per middleware and an explicit `sendContext` opt-in for anything
  crossing the client/server line.
- **RedwoodSDK** is the only other RSC framework with this built in, and it
  is the closest to what flypath needs: middleware are plain functions in
  the `defineApp([...])` array, per-route ones are called _interruptors_
  and sit in the route's own array (`route("/blog/:slug/edit", [isAuthenticated, EditBlogPage])`),
  **there is no `next()` at all** — returning a `Response` stops the chain,
  returning nothing continues — and `ctx` is a mutable bag reachable from
  server components and server functions via `getRequestInfo().ctx`.
- **Waku** documents the constraint flypath must not inherit: its
  `unstable_getRequest()` works in server components and server functions
  but _not_ in middleware, "because middleware runs before the render
  scope is established" — so middleware reads the request from Hono's
  context instead, and the app has two ways to read one request.
- **Nuxt's route middleware** is the ergonomic end of the spectrum:
  `defineNuxtRouteMiddleware((to, from) => ...)`, return `navigateTo()` or
  `abortNavigation()`, no `next()`, three registration styles (inline,
  named-by-filename, `.global` suffix).

The consensus: everyone agrees middleware is a function that either
continues or answers; the split is whether continuing is explicit
(`next()`) or implied by returning nothing, and whether shared values are
one untyped bag (Astro, SvelteKit, Hono, Redwood) or typed handles (React
Router, TanStack). Nobody has an ambient read surface that works
identically in middleware, server components and server actions — Waku
explicitly does not, React Router passes it as an argument three times.
flypath already has one for params, and should have one here.

## The model

**Middleware is a function that runs before a URL renders and may answer
instead.** It is not a network layer, it is not a proxy, and it does not
need a matcher: it is attached to a node of the route tree and it runs for
every URL under that node. The tree is the matcher.

**Everything it reads, it reads the same way a server component does.**
`params()`, `query()`, `platform()` are already ambient reads off the
request store (`runtime/platform-store.ts:16`). `headers()`, `cookies()`
and a context value join them. A middleware body and a server component
body read identically, because in flypath they run in the same store, in
the same request, on the same server.

**Only the server has middleware.** Every flypath navigation is a server
fetch — web goes through the `fetch` in `runtime/router-web.tsx:106`,
native fetches one payload per screen — so there is no client transition
that could slip past a guard. React Router needs `clientMiddleware` and
its "add a loader to force it" workaround precisely because it has
client-side navigation that never reaches a server. flypath structurally
cannot, which deletes half of React Router's middleware API before it is
written.

## The signature

```ts
import type { Middleware, Next } from "flypath";

export const auth: Middleware = async (next) => {
  const user = await userFromSession();
  if (!user) return navigate("/login");
  session.set(user);
  return next();
};
```

```ts
export type Next = () => Promise<Response>;

export type Middleware = (
  next: Next,
) => void | Response | Promise<void | Response>;
```

### Why there is no request — as a parameter or at all

The direct answer to "should middleware just be `(request: Request)`": no,
and the stronger claim is that **flypath should not expose a `Request`
anywhere**, to middleware or to anything else. Take the `Request` apart and
every field is either already covered, deliberately withheld, or actively
dangerous:

- **The body is not the app's to read.** `runAction` consumes it —
  `await request.formData()` or `await request.text()`
  (`server-entry.tsx:71`, `72`, `89`) — and middleware runs _before_
  `runAction` by design, because that is what a guard on a mutation is
  for. So an ambient `request()` puts `.formData()` one keystroke away
  from silently emptying the body and breaking every server action on the
  page. This is not a hypothetical footgun; it is the guaranteed outcome
  of the obvious thing to try. Astro documents the same hazard for
  `next(request)`.
- **The URL is already covered, on purpose.** `params()` and `query()` are
  the accessors, and plan 8 deleted `usePathname` deliberately.
  `request().url` restores a second source of routing truth — the exact
  thing plan 8 exists to have removed.
- **`method` is already abstracted** as `phase: "render" | "action"`
  (`platform.ts:9`), which is the distinction that means something here.
- **`Request` is web-shaped.** flypath renders on iOS and Android, where
  the transport is an implementation detail of the platform layer.
  `platform()` and `isNative()` are the abstraction; a `Request` invites
  code that assumes a browser made it.
- **The headers are the only part anyone wants**, and they get their own
  accessor.

So the store carries `Headers`, never a `Request`. The body is then
structurally unreachable from app code rather than merely discouraged,
which is the difference between a documented hazard and one that cannot
happen.

The libraries agree. The server-component pattern for Better Auth and
Auth.js is `auth.api.getSession({ headers })`, not `({ request })` — so
`headers()` returning a real `Headers` hands them what they want directly.
The place a `Request` genuinely belongs is an API route, which flypath does
not have yet; when it does, that handler takes it as a **parameter**, at
the one boundary that owns the body.

With nothing left to pass, the parameter question answers itself, and what
falls out is worth more than the discoverability lost: **a middleware body
is a server component body.** The same five lines lift into a page or a
server action unchanged. A guard is a guard.

The cost is real and named in the risks: `auth` is not callable as
`auth(new Request(...))` in a unit test. It never was going to be — it
also calls `navigate()`, `params()` and `session.set()`, all of which need
the store — so the test always had to be `runWithRequest(info, () => auth(next))`.

### Why `next` is a parameter, and optional

The direct answer to "should `next()` be required or automatic": it is a
parameter, and calling it is optional. Both halves matter.

**Optional, because the common case has nothing after it.** A guard reads a
session, redirects or stores a value, and is done. Requiring
`return next()` on every guard is ceremony that also invents a new failure
mode — forgetting it silently hangs the request. So: **a middleware that
returns without calling `next()` has `next()` called for it.** This is
React Router's resolution, and it is also, by another route, RedwoodSDK's
and Nuxt's and Next's — three frameworks that decided the after-phase was
rare enough to drop `next()` entirely.

**Present, because the after-phase is the only thing that distinguishes
middleware from a helper function.** Without `next()`, "run before" is just
a function you call at the top of a component. Timing, response headers,
a 404-to-CMS fallback, a transaction that commits on success and rolls
back on a 5xx — all of them need to see the response. Redwood's design has
no way to express any of them; Astro, Hono, SvelteKit and React Router all
kept the handle for this reason.

The full contract:

| what the middleware does                | what happens                                         |
| --------------------------------------- | ---------------------------------------------------- |
| returns without calling `next()`        | `next()` runs; its response is the answer            |
| returns a `Response`                    | that is the answer; the rest of the chain is skipped |
| calls `next()`, returns its result      | that response is the answer                          |
| calls `next()`, returns `undefined`     | `next()`'s response is the answer                    |
| calls `next()`, returns a different one | the returned response wins                           |
| calls `next()` twice                    | error — a request has one downstream                 |
| calls `navigate(...)`                   | throws; the chain unwinds into a navigation response |

The fourth row is the one flypath adds to React Router's list. React Router
requires server middleware to return the `Response` it got from `next()`;
flypath remembers it, so `await next()` followed by a bare `return` is
correct and the only reason to return anything is to _replace_ the answer.

### `navigate` is already the short-circuit

`navigate()` throws a `NavigationError` (`router/navigation.ts:19`), and
`handler` already knows how to turn that into a 307/308, an
`x-flypath-navigate` header or a 404 body. So middleware needs no
`redirect()` of its own, no `abortNavigation()`, no `NextResponse.redirect`
— the verb the app already uses everywhere works here unchanged, and
`return navigate("/login")` from a middleware means exactly what it means
in a server component.

The runner catches `NavigationError` from an inner middleware and converts
it to a `Response` **before** returning from `next()`, so an outer
middleware always sees a `Response` and never has to know that redirects
travel as throws. That matters because a render-time `navigate()` is
already caught, not thrown — `toFlight`'s `onError` swallows it
(`server-entry.tsx:143`) and it becomes a response afterwards. Without the
conversion, `next()` would throw for a middleware redirect and return for
a component redirect, which is the kind of inconsistency that makes
after-phase code untrustworthy.

## Where middleware is declared

In `routes.ts`, in the options bag, on any builder:

```ts
import { auth, requestId } from "./middleware.ts";

const config = routes({ middleware: [requestId] }, [
  layout(
    () => import("./shell.tsx"),
    [
      stack([
        branches(
          () => import("./tab-bar.tsx"),
          [
            stack([index(() => import("./feed.tsx"))]),
            stack([
              route("me", () => import("./profile.tsx"), {
                middleware: [auth],
              }),
            ]),
          ],
        ),
        stack({ middleware: [auth] }, [
          route("settings", () => import("./settings.tsx"), {
            safeArea: ["top"],
          }),
          route("compose", () => import("./compose.tsx"), {
            presentation: "modal",
          }),
        ]),
      ]),
      notFound(() => import("./not-found.tsx")),
    ],
  ),
]);
```

### Why not `export const middleware` from the route module

The direct answer to "just make layouts/routes export a `middleware`
function": no, and the reason is mechanical rather than aesthetic.

Every node in flypath's tree holds a `Loader` — `() => import("./settings.tsx")`
(`router/types.ts:15`) — and nothing is imported until
`componentOf` runs it (`router/router-server.tsx:45`). To read
`export const middleware` from `./settings.tsx`, the server must import
`./settings.tsx`, which imports its styles, its client components, its data
module, and its whole transitive graph. **The guard would have to load the
page in order to decide not to show it.** For an unauthenticated request
that is the entire cost of the page, paid for a 307. On native, where a
push fetches a payload per screen and a cold guard fires on every one of
them, it is worse.

Three smaller reasons point the same way:

- **Order becomes invisible.** With middleware in modules, the execution
  order of a guard chain is spread across five files and derivable only by
  re-deriving the tree. In `routes.ts` it is the indentation.
- **`stack()` has no module.** A stack is the natural unit to guard — "these
  three screens need a session" — and it has no component to export from.
  The module convention cannot express it; the config can.
- **`routes.ts` is already the one file that is statically read.** The Vite
  plugin parses it for the client manifest (`vite/routes.ts:46`) and the
  RSC environment imports it for real (`vite/routes.ts:97`). Middleware
  added there is on the server tree with zero extra loading and never
  reaches the client.

### The extractor change this forces

Middleware in the options bag **breaks the build today**, and the fix is
the load-bearing detail of this section. `options()` evaluates the entire
object literal (`vite/route-extract.ts:114`) and `evaluate` throws
`StaticError` on any identifier it cannot fold (`vite/eval.ts:46`), so
`{ middleware: [auth] }` fails with `flypath: "auth" is not statically
known here`. Even if it folded, the result is `JSON.stringify`d into the
client manifest (`vite/routes.ts:100`).

So the options bag splits in two, and the split is exactly right:

- `RouteOptions` — `safeArea`, `presentation`, `prefetch` — are _client_
  facts, statically extracted, serialized into the manifest.
- `middleware` is a _server_ fact. The extractor drops the key before
  evaluating; the manifest never sees it; the real tree the RSC
  environment imports carries the real functions.

Same object literal at the call site, two destinations. Nothing else in
`RouteOptions` moves.

### Builder signatures

`route(pattern, load, options?, children?)` already has the slot.
`index` and `notFound` already have it. The three that do not gain it, as
an overload discriminated by `Array.isArray`, so existing call sites are
untouched:

```ts
routes(children);
routes(options, children);
layout(load, children);
layout(load, options, children);
stack(children);
stack(options, children);
branches(load, children);
branches(load, options, children);
```

`routes()` gains the slot because app-wide middleware — logging, request
id, session parsing — is the most common kind, and an app with no root
`layout()` has nowhere else to put it.

### Order

Outermost first, in declaration order, then unwinding inward-out. For
`/settings` in the tree above: `requestId` → `auth` → render → `auth`
after-phase → `requestId` after-phase.

**Middleware follows the URL, not the rendered subtree.** A screen fetch
renders only part of the chain (`renderMatch` skips the container's
ancestors, `router-server.tsx:82`) and a fragment fetch renders none of it
(`renderFragment`, `router-server.tsx:110`). Middleware ignores that
entirely and runs the full declared path from the root to the matched
route every time. If it did not, fetching a nested screen directly would
skip the root guard, which is an auth hole rather than an optimization.

When nothing matches, the chain of the `notFound()` node runs — it has one
(`flatten.ts` gives the fallback a `chain`), so a 404 under a guarded
subtree is still guarded.

## `context` — sharing data

```ts
// app/session.ts
import { context } from "flypath";
import type { User } from "./db.ts";

export const session: Context<User> = context<User>();
export const visitor: Context<User | null> = context<User | null>(null);
```

```ts
// app/middleware.ts
export const auth: Middleware = async () => {
  const user = await userFromSession();
  if (!user) return navigate("/login");
  session.set(user);
};
```

```ts
// app/profile.tsx — a server component
export default function Profile() {
  return <Text>{session().name}</Text>;
}
```

```ts
// app/actions.ts — a server action
export async function postNote(formData: FormData): Promise<void> {
  notes.push({ author: session().id, body: String(formData.get("note")) });
}
```

`context<T>()` returns a callable reader with a `set`. Calling it reads;
`context<T>(fallback)` supplies a value for requests where nothing set one,
and without a fallback an unset read throws by name — the same choice
`params(name)` already makes (`router/read.ts:25`), and the loud version of
React Router's reported `No value found for context`.

```ts
export type Context<T> = {
  (): T;
  set: (value: T) => void;
};
```

Under `isolatedDeclarations` a callable with properties needs the explicit
annotation shown above, same as `Navigate`.

### Why a reader, and not a bag passed in

React Router's `context.set(userContext, user)` needs a `context` object in
hand because its loaders and actions receive one as an argument. flypath's
components receive nothing (`router-server.tsx:89`), and its actions are
called by React with the user's own arguments — there is no slot to thread
a bag through and no way to invent one without changing what a flypath
page _is_.

That constraint turns out to be the better design anyway. The bag
disappears, the store holds a `Map` keyed by the context handles, and
reading is `session()` rather than `context.get(sessionContext)` — one
symbol imported from one file, with a real type on it, not a string key in
a globally-declared interface. It avoids Astro's and SvelteKit's flat
`locals` (no per-value typing, no idea which middleware fills which key)
and Hono's `ContextVariableMap` (types visible in handlers the middleware
never ran for) in the same move: a handle you did not import is a handle
you cannot read.

The mechanism is the store flypath already runs. `handler` wraps the entire
request in `runWithRequest` (`server-entry.tsx:194`), including the action
phase and the render, so a `Map` carried on `RequestInfo` is visible to
everything downstream and is per-request by construction. `set` is
mutation of that map, which is why it is legal only while middleware is
running — a `set` from inside a render would race the concurrent render of
a sibling and be visible or not depending on scheduling. Calling `set`
outside middleware throws.

### What context is not for

`React.cache()` already deduplicates any value that is _derivable_ from the
request, for the whole render, with no declaration:

```ts
const currentUser = cache(async () => userFromSession());
```

If a layout and a page both call that, the work happens once. Context earns
its place only for values that are _decided_ rather than derived — a
request id, a resolved feature-flag snapshot, an already-opened
transaction, the result of a guard that also redirected — and for reaching
a server action, which is not part of a render. Anything a page could
compute for itself should stay a `cache()`d function, and the docs should
say so, because a context handle is a coupling between a route's config and
a component's body that `cache()` does not create.

## Headers, cookies, and the response

Middleware without cookies is half a feature, so this plan carries the
prerequisites rather than assuming them. Two readers and one writer, and
no `Request` behind any of them.

```ts
import { cookies, headers, isPrefetch } from "flypath";

headers(); // Headers — a snapshot of the incoming ones
headers().get("accept-language");
auth.api.getSession({ headers: headers() });

cookies("session"); // string | undefined
cookies.set("session", token, { httpOnly: true, maxAge: 604800 });
cookies.clear("session");

isPrefetch(); // boolean
```

- `headers()` returns a `Headers` rather than a plain record, because the
  thing callers most want to do with it is hand it to a session library
  whole. It is a per-request snapshot, so mutating it changes nothing.
- `cookies()` is sugar over `headers().get("cookie")`, and earns its place
  because cookie parsing is fiddly and it is the 95% case.
- `RequestInfo` gains `headers: Headers` (incoming), `outgoing: Headers`,
  `prefetch: boolean`, and the context `Map`. It never gains the `Request`.
- `handler` merges `outgoing` into every `Response` it builds — all six
  construction sites — so a `Set-Cookie` written by a middleware, a server
  component or a server action lands on whatever the answer turns out to
  be, including a 307 and a 204.
- `cookies.set` from a server action is what makes a login flow
  expressible; it is one write into that bag. Reads are ambient; every
  other write goes through the response a middleware returns, because a
  middleware is the only place that has one in hand.

Streaming is not a concern yet: `toFlight` collects the whole payload into
bytes before responding (`server-entry.tsx:101`), so an after-phase that
rewrites headers is always in time. When flypath streams, "after `next()`"
becomes "after the headers, before the body finishes", which is the same
caveat every onion framework carries.

## What runs when

| request                                   | middleware runs                                    |
| ----------------------------------------- | -------------------------------------------------- |
| document `GET /settings` (web)            | chain for `/settings`                              |
| flight `GET /settings?__flight=1`         | chain for `/settings`                              |
| screen fetch, `x-flypath-screen` (native) | chain for the screen's URL                         |
| fragment fetch, `x-flypath-fragment`      | chain for the request URL                          |
| action `POST` (`x-rsc-action`)            | chain for the URL posted to, **before** the action |
| hover prefetch                            | chain for the hovered URL                          |

Middleware runs before `runAction` (`server-entry.tsx:200`), which is the
whole point of a guard on a mutation, and the after-phase runs once the
response exists.

Two consequences to state out loud rather than discover:

**One navigation is several requests.** Native fetches a payload per screen
and a fragment per container; web fetches a document and then a payload per
transition. Middleware runs per HTTP request, not per navigation, so it
must be cheap and idempotent. This is the same bill SvelteKit's `sequence`
waterfall gets criticized for, and there is no way to avoid it in a
framework where the server owns every render.

**A server action's middleware is the page's, not the action's.** Actions
POST to the current URL (`runtime/native-actions.ts:22`, and the web
callback does the same), so the chain that runs is the chain of the route
the user is standing on — nothing knows or cares which module the action
was defined in. Move an action, or call it from a second page, and its
guard changes. This is exactly the trap Next.js documents for Server
Functions and Proxy, and the mitigation is theirs: **middleware is a route
guard, not a function guard; anything that matters is re-checked inside the
action** — which `session()` makes a one-liner, since the same handle reads
in both places.

## Prefetch

`prefetch: "hover"` issues a real request on hover (`router-web.tsx:410`)
that is indistinguishable from a visit, and caches the payload so the
eventual click may never hit the server again. A middleware that writes —
"record last seen", "consume a one-time token", "count the view" — will
therefore fire on hover, and not fire on the visit.

The hover fetch gains `x-flypath-prefetch: 1`, surfaced as `isPrefetch()`
— named for the `isNative()` / `isIos()` family it joins in
`index.shared.ts`, and to keep it clear of the `prefetch` route option —
so a writing middleware can opt out in one line. This
is the same escape hatch Next.js exposes as `has`/`missing` matchers on
`next-router-prefetch`, minus the regex.

## What changes

- `runtime/platform.ts` — `RequestInfo` gains `headers`, `outgoing`,
  `prefetch`, and the context `Map`; `isPrefetch()` alongside `isNative()`.
- `runtime/server-entry.tsx` — the middleware runner between
  `matchRoutes` (line 189) and `runAction` (line 200); outgoing headers
  merged into all six `Response` sites.
- `router/config.ts`, `router/types.ts` — options overloads on `routes`,
  `layout`, `stack`, `branches`; `middleware` on the node types, outside
  `RouteOptions`.
- `router/flatten.ts` — collect the middleware of every enclosing node into
  `FlatRoute`, in declaration order, including the `notFound` fallback.
- `vite/route-extract.ts` — drop the `middleware` key before `evaluate`,
  and say so in the error when someone puts a function anywhere else in the
  bag.
- `runtime/router-web.tsx` — `x-flypath-prefetch` on the hover fetch.
- New: `router/middleware.ts` (runner, `Middleware`, `Next`),
  `router/context.ts` (`context`), `runtime/cookies.ts`.

Nothing is deleted — this plan is additive, which is the first time that
has been true since plan 6.

## Phases

### Phase 1 — headers and cookies

`headers()`, `cookies()` / `cookies.set` / `cookies.clear`, the outgoing
`Headers` on the store, merged into every response. `prefetch` on
`RequestInfo`, `isPrefetch()`, and the header that sets it. No middleware
yet; this phase alone makes a session readable from a server component,
which the framework cannot do today.

### Phase 2 — the chain

`Middleware`, `Next`, the runner, `middleware` in the options bag, the
builder overloads, the extractor skip, `flatten` collecting the chain.
Ordering, the optional-`next` contract, `NavigationError` converted to a
`Response` inside `next()`. Example app grows `middleware.ts` with `auth`
and guards `/settings` and `/compose`.

### Phase 3 — the context

`context<T>(fallback?)`, the map on the store, `set` restricted to the
middleware phase with a loud error elsewhere. `auth` stores the user;
`/me` and the `postNote` action both read it. This is the phase that
proves the ambient read surface spans middleware, component and action.

### Phase 4 — polish

Dev-only errors for the whole list: `next()` twice, `set` outside
middleware, a function left in `RouteOptions`, middleware imported into a
client component. The prefetch guidance. Native cookie verification on
both platforms. `next(request)`-style rewriting is explicitly _not_ in this
phase — see risks.

## Key decisions

- **Middleware is `(next) => void | Response`.** There is nothing to pass
  it: server components have no props, so every read is ambient already.
- **No `Request` is exposed, to middleware or anywhere.** Its body belongs
  to `runAction`, its URL is `params()`/`query()`, its method is `phase`,
  and it is web-shaped in a framework that renders on three platforms.
  The store carries `Headers`, so the body is unreachable by construction
  rather than by convention. An API route, when flypath has one, takes the
  `Request` as a parameter — at the boundary that owns the body.
- **`next()` is passed but optional.** Not calling it continues; returning
  a `Response` answers; returning `undefined` after calling it keeps
  `next()`'s response. The after-phase is the only thing that makes
  middleware more than a helper function, so the handle stays — but it
  never has to be typed by a guard that has nothing to say afterwards.
- **`navigate()` is the short-circuit**, unchanged from everywhere else it
  is used. No `redirect`, no `abortNavigation`, no `NextResponse`.
- **Declared in `routes.ts`, not exported from route modules.** A module
  export would require importing the page to decide not to render it, and
  would put the execution order in five files instead of the indentation.
- **`middleware` sits in the options bag but leaves `RouteOptions`.**
  Route options are client facts that get statically extracted and
  serialized; middleware is a server fact on the real tree. One literal,
  two destinations.
- **Middleware attaches to every builder, including `stack()`**, and runs
  for the whole subtree. Guarding a stack is the common case and a stack
  has no module to export from.
- **Middleware follows the URL, not the rendered subtree**, so a screen or
  fragment fetch cannot slip past an ancestor's guard.
- **Server only.** Every flypath navigation is a server fetch, so a client
  middleware would guard nothing that the server does not already guard —
  and React Router's `clientMiddleware` plus its force-a-loader workaround
  are both symptoms of an architecture flypath does not have.
- **Context is a callable handle, not a bag.** `session()` over
  `context.get(sessionContext)`, because there is no argument slot to pass
  a bag into, and because an imported handle types itself and cannot be
  read where it was not imported.
- **`cache()` stays the answer for derivable values.** Context is for what
  is decided, not what can be recomputed.

## Risks / open questions

- **Middleware is not unit-testable in isolation.** With no parameters but
  `next`, testing `auth` means `runWithRequest(info, () => auth(next))`.
  This was always true — it also calls `navigate()` and `session.set()` —
  but the signature no longer hints at it. The mitigation is a test helper
  that builds a `RequestInfo` from a `Request`, which is the one place the
  framework still translates one.
- **Withholding `Request` costs three things, none yet paid for.**
  `request.signal` has no replacement, so a middleware cannot abandon
  expensive work when the client disconnects — a `signal()` accessor if it
  ever earns one. A middleware that wants the raw pathname, to rewrite a
  legacy URL space wholesale, has no accessor either; the flypath-shaped
  version is a `route("old/:id")` whose middleware calls
  `navigate("/new/:id", { id: params("id") })`, and if that proves too
  narrow the answer is a `path()` string, still not a `Request`. And a
  session library that insists on a `Request` rather than `headers` has to
  be handed `new Request(url, { headers: headers() })` by the app — a
  body-less stand-in, which is exactly what such a library should be
  reading anyway.
- **Nothing enforces that a guard covers an action.** The action POSTs to
  the page's URL, so the guard that runs is the page's. A build-time check
  could in principle map `"use server"` exports to the routes that import
  them, but a server action can be passed as a prop, so the map is
  incomplete by construction. v1 documents the Next.js rule — re-check
  inside the action — and Phase 4 could warn when an action module is
  imported by a route with no middleware in its chain.
- **`set` outside middleware throws, and the boundary is fuzzy.** A server
  action is not a render, so a `set` there is safe in practice; forbidding
  it is conservative and may be annoying enough to relax. Allowing it means
  documenting that a value set during a concurrent render is visible to
  siblings unpredictably.
- **Prefetch runs guards early and skips them late.** The
  `x-flypath-prefetch` flag makes it detectable, not correct: the payload
  cache (`router-web.tsx:121`) means the request that ran the middleware is
  not the request the user eventually makes. A guard that redirects will
  still redirect, because the prefetched payload _is_ the redirect; a
  guard that logs will log at the wrong time.
- **Cookies on native are unverified.** React Native's fetch uses the
  platform cookie store on both platforms, and flypath ships
  `react-native-fetch-api`; whether `Set-Cookie` round-trips through it on
  iOS and Android is something Phase 4 has to confirm on a device rather
  than assume. If it does not, the escape hatch is a token in a header,
  which middleware reads identically.
- **No rewrite, no `next(request)`.** Astro's `next(new Request("/login"))`
  and Next's `NextResponse.rewrite` render a different route under the
  original URL. flypath's payloads carry their own route scope
  (`RouteScope`, plan 8), so a rewrite would have to decide whether the
  client is told the URL it asked for or the one that rendered — and on
  native, which container the swapped screen belongs to. Deliberately out
  of scope; `navigate()` covers the redirect case, and `notFound()` covers
  the other one.
- **The onion is a waterfall.** Two middleware that each await a database
  round trip cost two round trips before the render starts, and there is no
  parallel form. This is SvelteKit's documented complaint about `sequence`.
  A `Promise.all` inside one middleware is the workaround; a declared
  parallel group is a later plan, if ever.
- **Context handles couple a component to a route's config.** A component
  reading `session()` only works under a route whose chain sets it, and
  nothing checks that — the same unverifiable claim React Navigation warns
  about for `useRoute` and plan 8 refused for `useParams<"/p/:id">()`. The
  fallback form `context<User | null>(null)` makes it safe at the cost of a
  null check; the throwing form makes it loud at the cost of a runtime
  discovery.
