# Flypath — one navigation verb, one param scope

## Goal

Collapse the navigation API into a single function that means the same thing
in every environment flypath runs code in — server component, server action,
client render, client event handler, web, iOS, Android — and give param
reading a scope that is correct on a native stack instead of a global that
reports whichever screen happens to be focused.

Plans 6 and 7 built the machinery: a route tree, placements, containers,
per-screen payloads. They left the surface split five ways, and left params
broken on native. This plan replaces the surface. Nothing here is
backwards compatible: `redirect`, `notFound`, `back`, `useParams`,
`useSearchParams`, `useNavigation` and `NavigationContext` are deleted.

Milestone: `example/app/post.tsx` reads its `:id` correctly while sitting
under `/settings` in a native stack, and every navigation in the example
app — link, button handler, server action, server component guard — goes
through the same call.

## What is broken today

**Params on native are global.** `native-root.tsx:186` builds one
`Navigation` from `focusedScreen(router)?.url` and provides it at the root.
Every mounted screen — background screens in the same stack, and every
screen in the three retained branch stacks — reads the focused screen's
params. Push `/p/1` then `/p/2` and the client components in the first
screen report `id: "2"`. Expo Router names this exact pair
(`useGlobalSearchParams` vs `useLocalSearchParams`) and documents the
global one as the performance-and-correctness hazard; flypath only has the
global one.

**Params are computed in four places.** The server matches the live tree
(`server-entry.tsx:164`); SSR gets them again through `SsrOptions`
(`ssr-entry.tsx:27`); the web client re-matches the manifest on every
render (`router-web.tsx:460`); native re-matches it again
(`native-root.tsx:189`). Four derivations of one fact, each able to
disagree — the modal case already does, since the web value is taken from
`state.modal?.url ?? state.url` while the payload underneath was rendered
for the background URL.

**Fragment params are frozen.** `native-router.ts:84` fetches a
container's chrome once and keeps it. A layout above a container that reads
params holds the params from whatever URL first mounted it.

**The type parameter on `useParams<"/p/:id">()` is a claim, not a check.**
Nothing verifies the component renders under that route. React Navigation
documents the identical hazard for `useRoute` and tells you to prefer
props.

**`useSearchParams()` returns `Record<string, string | string[]>`**, so
every single read needs an `Array.isArray` guard before it is usable.

**The write surface is split by environment and enforced at runtime.**
`redirect()` and `notFound()` exist twice — once real
(`router/server.ts`), once as a stub whose whole body is a thrown error
telling you that you called it in the wrong place (`router/client.ts:47`).
`back()` exists only on the client, reaching a module singleton registered
by whichever root mounted (`router/client.ts:18`). Nothing navigates from a
server action except `redirect`, and it can only replace.

**`useParams` on the server is not a hook.** It is an AsyncLocalStorage
read that works fine in a server action, where no hook can run. The `use`
prefix is a lie in the one place the function is most useful.

## Field notes — prior art

- **go_router** is still the closest analogue and is the most fragmented:
  `go`, `push`, `pushReplacement`, `replace`, `pop`, and a parallel named
  family — `goNamed(name, {pathParameters, queryParameters, extra,
fragment})`, `pushNamed`, `pushReplacementNamed`, `replaceNamed`,
  `namedLocation` — eleven entry points where flypath wants one. Reads go
  through `GoRouterState.of(context).pathParameters`, a context read.
- **Nuxt is the proof that one universal function works.**
  `navigateTo(to, { replace, redirectCode, external, open })` performs an
  HTTP redirect on the server and a router transition on the client, from
  the same call, in components, middleware and plugins. Its one wart is
  that middleware must `return` it — the framework cannot make a call that
  unwinds the render look like a call that does not.
- **Next.js already splits the mode by call site, and says so.**
  `redirect(path, type)` defaults to `replace` everywhere except Server
  Actions, where it defaults to `push`, and "the `type` parameter has no
  effect when used in Server Components". 307 by default, 303 for
  progressively-enhanced form posts, 308 via `permanentRedirect`. But it
  stops one step short: `redirect` "can be called in Client Components
  during the rendering process but not in event handlers. You can use the
  `useRouter` hook instead." That last sentence is the split this plan
  deletes.
- **Expo Router** is the only router that merges path and query into one
  bag on both sides: any key in `params` that does not match a dynamic
  segment "is equivalent to a query parameter", and `useLocalSearchParams`
  returns both merged.
- **Vue Router and Angular keep them separate on the write side** —
  `router.push({ name, params, query })`, `router.navigate([...],
{queryParams})` — and Vue additionally forbids `params` alongside `path`,
  which is why it needs named routes at all. flypath's patterns are already
  unique names, so it needs no name registry.
- **TanStack Router** keeps `params` and `search` separate, and makes both
  accept updater functions (`search: (prev) => ({...prev, page: prev.page +
1})`). It is also the only one with per-route search schemas
  (`validateSearch`), which is where typed non-string query values come
  from.
- **React Navigation** merges name and params (`navigate(name, params)`),
  and has `setParams` because there params are client state. It also warns
  that annotating `useRoute` is not type-safe "because the type parameter
  cannot be statically verified".

The consensus flypath can improve on: everyone agrees the _destination_ and
its _params_ belong in one call; nobody has a single verb that spans server
and client because nobody else renders the same tree in both. flypath does.

## The model

Two ideas, and everything else falls out of them.

**Navigation is one verb.** `navigate(to, params?)` means "go there". What
"go there" compiles to depends on where it runs — an HTTP redirect, an
instruction to the client, a stack push, a history entry — but the call
site never changes and never needs to know.

**Reading is scoped to the render that matched.** A param is not ambient
app state; it is a property of the subtree the server rendered for a URL.
So the server puts the scope _into the payload_, and every environment
reads it from there. Native gets per-screen params for free, because
native already fetches one payload per screen.

## `navigate` — the write surface

```ts
import { navigate } from "flypath";

navigate("/explore");
navigate("/p/:id", { id: post.id });
navigate("/p/:id", { id: post.id, ref: "feed" });
navigate.replace("/login");
navigate("back");
navigate("not-found");
```

The first argument is a **destination**: any `Href` or `Pattern` from the
registered route tree, an `ExternalHref`, or one of two reserved words.
Reserved words cannot collide with app routes because every flypath href
starts with `/`, so `"back"` and `"not-found"` are unambiguous by
construction and the whole destination space stays one string union — a
destination can be stored in a variable, returned from a helper, or held in
a config object.

The second argument is **one bag**, Expo-style: keys that name a `:param`
in the pattern fill the path; every other key becomes a query parameter.
Values are `string | number | boolean | null | undefined` or an array of
those; nullish values drop the key, arrays repeat it. Path params are
percent-encoded. The bag is required exactly when the pattern has holes,
using the same conditional-tuple trick `HrefArgs` already uses
(`router/types.ts:150`).

`href()` keeps the identical signature and remains the way to build a
string for `<a href>`. `navigate(to, params)` is defined as "go to
`href(to, params)`", so there is one encoder.

### What it means where

| call site                     | `navigate(href)`                                                                                | `navigate("back")`                          | `navigate("not-found")`                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| server component render       | aborts the render; 307 + `location` for a document GET, `x-flypath-navigate` for a flight fetch | error — there is no history during a render | 404; the `notFound()` route renders in place |
| server action                 | aborts the action; tells the client to **push**                                                 | tells the client to pop                     | 404 payload; the client swaps it in          |
| client event handler / effect | push                                                                                            | pop the focused container                   | error — server only                          |
| client render                 | push (see risks)                                                                                | pop                                         | error — server only                          |

Native rows are identical: a push reconciles the target placement through
plan 7's container tree, a pop is `goBack()` on the focused chain. The
platform difference lives entirely under `navigate`.

Two things fall out of this table that are worth stating out loud:

- **A server action can do anything the client can do**, because the client
  is already waiting for its answer. "Save and close" becomes
  `navigate("back")` at the end of the action, which today is not
  expressible at all.
- **A server render replaces; every other phase pushes.** This is not a
  special rule invented here, it is Next's rule, and it is the only correct
  default: Back must never land on a page whose render immediately
  navigates away. The server knows which phase it is in because `runAction`
  runs before the render inside the same `runWithRequest`
  (`server-entry.tsx:173`); it gets a `phase` field. The client has no such
  signal, so a client _render_ pushes like a handler does — the one place
  the rule is not honoured, and the first risk below.

### Return type

`navigate("not-found")` and `navigate.permanent(...)` are typed `never`, so
`if (!post) navigate("not-found");` still narrows `post` afterwards, which
`example/app/post.tsx:10` depends on. Every other form is typed `void`,
because on the client it genuinely returns. Where a server component needs
the compiler to stop, the idiom is Nuxt's:

```ts
if (!user) return navigate("/login");
```

### Variants

```ts
navigate.push(to, params?);
navigate.replace(to, params?);
navigate.permanent(to, params?);
```

`push` and `replace` force the mode instead of taking it from the call
site. `permanent` is server-only and answers with 308; it throws a clear
error in the browser, the way today's client `redirect` stub does.

Under `isolatedDeclarations` a callable with properties needs an explicit
type, so this is `export const navigate: Navigate = …` over a declared
`Navigate` interface, not a function declaration with assignments.

## Replace, and what belongs in the route config

Two questions, two different answers.

**The push/replace mode is not a route property.** It describes the
transition, not the destination: `/login` should replace when a guard
redirects into it and push when a user taps "sign in". A route option would
have to be right for both, and cannot be. It stays at the call site, as
`navigate.replace`, and defaults from the phase as above. This is the same
line plan 6 already drew — route options describe navigation behaviour of
the _destination_, which is why `presentation: "modal"` and `safeArea` are
correctly in the config and `replace` is not.

**Params are ad-hoc, and stay strings, in v1.** Path params are already
declared structurally by the pattern (`:id`) and are always strings because
URLs are. The interesting version of "params in the config" is TanStack's
`validateSearch` — a per-route schema that makes `params("page")` a
`number` and validates on the way in. That is a real feature and it is
deliberately not in this plan: a schema is code, and the client route
manifest is statically extracted by `eval.ts`, which can read an options
object literal and cannot read a Zod schema. Adding it means deciding where
validation runs (server only, or shipped) — a separate plan. The surface
here does not foreclose it: `params("page")` returning `string` today can
return `number` later without changing a call site.

## `params` and `query` — the read surface

```ts
import { params, query } from "flypath";

params("id"); // string — the route matched, so it exists
params(); // Params — path params, merged with query
query("ref"); // string | undefined — query strings are user input
query(); // SearchParams
query.all("tag"); // readonly string[]
```

Both work in server components, server actions, and client renders, on all
three platforms, with no hook prefix because neither is a hook on the
server and both are legal in conditionals on the client (they read context
through React 19's `use`).

The write side merges path and query into one bag; the read side splits
them. That asymmetry is deliberate and it is the whole argument for having
two functions instead of one:

> Writing, the pattern already says which is which — you should not have to
> repeat it. Reading, the only thing types can tell you is whether the
> value is guaranteed, and that is exactly what the split encodes:
> `params("id")` is `string` because the route matched; `query("ref")` is
> `string | undefined` because a query string is whatever the user pasted.

`params(name)` throws when the matched route has no such param — a caller
bug, made loud. `params()` merges query into the bag for the cases that
just want to forward everything (`example/app/nav-demo.tsx:13` prints it),
with path params winning a name collision.

There is no `useParams<"/p/:id">()` generic, because it cannot be checked;
there is no `setParams`, because in flypath a param is URL state and the
only way to change it is `navigate`; and there is no observable-param
machinery, because scope gives reactivity for free — when the scope
changes, the subtree that reads it re-renders. That is the direct answer to
"do we really need the param to be observable": no. Changing a param is a
navigation, and a navigation re-renders. Search-as-you-type is the one case
that wants a change without a round trip, and it is served the way every
other framework serves it — keep the input in client state, and
`navigate.replace` when you want the URL to catch up.

`usePathname` stays deleted; chrome that highlights a switcher uses
`useBranches()`, which reads router state rather than guessing from a path.

## Scope injection

The one mechanism that makes reading work everywhere:

- `renderMatch` (`runtime/router-server.tsx:72`) wraps the composed screen
  in `<RouteScope pathname params query>`, a `"use client"` provider added
  to `router/scope.tsx` next to the existing `ContainerScope`, which is
  already proven to cross the server/client boundary this way.
- Therefore **every payload carries its own scope**: the web document, the
  web modal, each native screen, each container fragment. Native
  per-screen params become correct by construction — no global, no
  focused-screen guess, no re-match on the client.
- On the server, `params()`/`query()` read the AsyncLocalStorage store that
  `platform-store.ts` already maintains, so they keep working in server
  actions.
- On the client they read the nearest `RouteScope`. A component below a
  modal reads the modal's params; a component in a background screen reads
  its own.
- `SsrOptions.pathname/params/searchParams` and the `NavigationContext`
  wrapper in `ssr-entry.tsx` are deleted — the scope arrives through the
  flight stream like any other element.
- `matchManifest` stays, but only for routing decisions (placement,
  `presentation`, `safeArea`, `prefetch`). It stops producing params, so
  the client no longer has a second matcher whose answer can differ from
  the server's.

Fragments keep plan 7's punt: a container's chrome is fetched once and its
scope is the URL that first mounted it. That is correct for every tree
where containers sit above the parameterized segments, and it is the same
limitation plan 7 already documented for containers nested under
`/user/:id`.

## Wire protocol

One header replaces the redirect header, for both flight fetches and
action responses:

```
x-flypath-navigate: {"kind":"go","to":"/p/1","mode":"replace"}
x-flypath-navigate: {"kind":"back"}
```

Document GETs are unchanged: a real 307/308 with `location`. `not-found`
needs no header — it is a 404 whose body is the `notFound()` route's
payload, which is already how render-time not-found works, and which now
also covers an action that calls `navigate("not-found")`.

`router-web.tsx` (`followRedirect`) and `native-root.tsx` /
`native-actions.ts` (`fetchPayload`, the server callback) each parse the
one header and call into the same dispatch as a user-initiated
`navigate`.

## Dispatch

`navigate` needs to reach the live router from a module that knows nothing
about React. Both runtimes already keep a module singleton for this —
`registerBack` (`router/client.ts:20`) on web, `setNativeRouter`
(`components/native/router-store.ts:15`) on native. Those merge into one
`router/dispatch.ts` with `setRouter(api)` / `getRouter()`, where

```ts
type RouterApi = {
  go: (href: string, mode: "push" | "replace") => void;
  back: () => void;
};
```

`WebRouter` and native `Root` each register one on mount. `registerBack`,
`back`, and the `push`/`replace` split on `NativeRouterApi` all go away.

## What gets deleted

- `router/client.ts` entirely — `NavigationContext`, `useNavigation`,
  `useParams`, `useSearchParams`, `registerBack`, `back`, and the two
  stub `redirect`/`notFound` that exist only to throw.
- `useParams` / `useSearchParams` from `router/server.ts`; `redirect` and
  `notFound` from `router/navigation.ts` (the `NavigationError` carrier
  stays and grows a `navigate` signal).
- The `Navigation`, `RouteParams`, and `Pattern`-as-hook-generic types.
- `SsrOptions.pathname` / `.params` / `.searchParams`.
- Client-side param derivation in `router-web.tsx` and `native-root.tsx`.
- `notFound()` as a _signal_ — the name survives only as the route builder
  in `flypath/router`, which removes today's collision where one name means
  two things in two modules.

## Phases

### Phase 1 — the verb

`navigate` with its destination union, conditional-tuple params, and
variants; `href()` extended to emit query strings; `router/dispatch.ts`;
the `NavigationError` signal grows `{ kind: "go", to, mode }`; the
`x-flypath-navigate` header on both ends; `phase: "render" | "action"` in
the request store so the mode defaults correctly. `redirect`, `notFound`
and `back` deleted. Example app switches every call site.

### Phase 2 — the scope

`RouteScope` injected by `renderMatch`; `params()` / `query()` on both
builds; `NavigationContext` and the four param derivations deleted;
`ssr-entry.tsx` plumbing removed. This is where native per-screen params
become correct — verifiable by pushing `/p/1` then `/p/2` and reading both
screens.

### Phase 3 — navigation from actions

`navigate("back")` and `navigate("not-found")` from a server action, push
as the action default, the client side of the header on web and native.
Example app grows a "post and go back" action in `/compose`.

### Phase 4 — polish

`ExternalHref` through `navigate` (`Linking.openURL` on native, assignment
on web), dev-only guards for the client-render case, and the error
messages: every environment-restricted call must name the environment it
was called from and the one it needs.

## Key decisions

- One verb, `navigate`, spanning server render, server action, client
  render and client handler, on all three platforms. Nuxt proves the shape
  works; Next proves the phase-dependent default is right; flypath is the
  first place it can also cover the client handler, because the same tree
  renders in both.
- Reserved words `"back"` and `"not-found"` occupy the destination slot
  rather than becoming methods, so the destination space stays one string
  union that can be stored and passed around. They are safe because every
  app href starts with `/`.
- Mode is a call-site concern (`navigate.replace`), never a route option.
  Route options describe the destination; the transition is not part of the
  destination.
- One params bag on the write side, pattern-driven (Expo's rule); two
  accessors on the read side, because required and optional are the only
  thing the types can usefully distinguish.
- Params stay strings and stay ad-hoc in v1. Per-route search schemas are
  a named future extension, blocked today by the static manifest
  extractor, not by this API.
- No pattern generic on reads, no `setParams`, no observable params. Scope
  supplies reactivity; `navigate` is the only mutation.
- The server injects the scope into the payload rather than the client
  deriving it. This deletes three of four param derivations and fixes
  native by construction rather than by adding a per-screen context on the
  client.
- `<a href>` stays the declarative form and shares `href()` with
  `navigate`, so the two spellings of "go there" encode identically.

## Risks / open questions

- **`navigate()` during a client component's render pushes**, because the
  client cannot cheaply tell render from handler, and a push there means
  Back returns to a page that navigates away again. Next allows this call
  and treats it as a replace; flypath cannot detect the phase without a
  dev-only `captureOwnerStack` probe. v1 documents "do not navigate during
  client render — use an action or a handler"; the probe is the fallback if
  it bites.
- **`params()` outside a client render throws.** On the server it works in
  actions via ALS; on the client, "which screen am I in" is a tree question
  and an event handler has no tree. The workaround is the normal one —
  read during render, close over the value. If that proves annoying, the
  extension is a module-level focused-screen fallback, which is exactly
  Expo's `useGlobalSearchParams` semantics and carries exactly its hazard.
- **A typo in a path param name silently becomes a query param.** The bag
  types required keys but must allow extras, so `{ di: "1" }` on `/p/:id`
  fails the required check but `{ id: "1", di: "1" }` does not warn. A
  build-time check over `navigate` call sites could catch it later.
- **`never` only on `not-found`** means `if (!user) navigate("/login")`
  does not narrow while `if (!post) navigate("not-found")` does. The
  uniform alternative — typing every form `never` — greys out legitimate
  statements after a push in an event handler. `return navigate(...)` is
  the documented escape; revisit if the inconsistency reads badly in use.
- **`navigate` returns `void`, not a promise**, so "navigate then do X" on
  the client has no join point. Returning a promise would split the return
  type across environments, which is the thing this plan exists to stop.
- **Fragment scope is still first-mount scope**, unchanged from plan 7's
  punt. A container under a parameterized segment reads stale params rather
  than wrong-screen params — better than today, still not right.
- **`query.all` is the only concession to repeated keys.** `query()` picks
  the first value for a repeated key, which is a behaviour change from
  today's `string | string[]` union and will silently drop values for
  anyone relying on it.
