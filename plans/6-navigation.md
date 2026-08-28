# Flypath — routing & navigation plan

## Goal

Explicit, code-configured routing (no filesystem conventions) plus a navigation
runtime that is browser-native on web and stack-based on native, expressive
enough to build Instagram/X-style tabbed apps where every tab owns its own
stack. The server stays the owner of all UI (RSC/SDUI); the client owns
navigation state and navigator chrome only. Includes a real `SafeAreaView`.

Milestone: the example app becomes a mini feed client — feed at `/`, permalink
at `/p/:id` (modal over the feed when reached in-app on web, pushed screen on
native), three parallel stacks (feed / explore / profile) presented as tabs by
the app's own chrome, safe areas configured per route.

## Field notes — how instagram.com actually routes

Inspected live through the module registry on www.instagram.com (it runs
Meta's Comet router; Polaris is just the IG product layer on top):

- **The route table is not shipped to the client.** `CometRouteStore`
  (`getRoute` / `fetchRoute` / `fetchForNavigation`) resolves URLs by calling
  `POST /ajax/bulk-route-definitions/` — batched, and prefetched for links
  before you click. Results are installed into a client-side cache
  (`CometRouteMapper.installRoute` / `installRedirect` /
  `installRouteResolver`).
- **A route definition is data, not code.** Shape observed:
  `{ url, routePath, params, canonicalRouteName, rootView: { resource,
allResources, props, entryPoint }, meta, tracePolicy, ... }` — a pointer to
  lazily-loadable JSResources plus a Relay EntryPoint whose
  `getPreloadProps(params)` names the GraphQL queries to preload.
- **Code and data load in parallel, suspend as a unit**, via EntryPoint
  containers (`loadIfNeeded` / `readOrSuspend` / `lock`) rendered by the
  router.
- **The dispatcher surface is small**: `go(url)`, `goTo(route)`, `goBack`,
  `popPushView`, plus three prefetch tiers — `prefetchRouteDefinition`,
  `preloadRouteCode`, `prefetchRouteQueries`.
- **Web router state is one live route.** `getCurrentRouterState()` returns
  `{ main: { route, entryPointContainer, referrer, ... }, routeKey }`. The
  browser history is the stack; parallel per-tab stacks exist only in the
  native apps.
- **The post modal is not a navigation.** Clicking a feed post rewrites the
  URL to `/p/…/` but the router still reports `url: "/"`,
  `routeKey: "initial"` — the modal is plain UI state and the URL change is
  for shareability. A cold load of the same URL renders the standalone
  permalink page. The state carries an `isBackgroundRoute` flag for exactly
  this pattern.

What transfers to flypath, given RSC:

- Route-as-data with the component as a pointer maps to our split: the server
  evaluates the real route tree; clients get a compact manifest (patterns +
  options, zero page code). Unlike Comet we need no server round-trip to
  resolve a URL — their table is huge and deploy-coupled, ours is one config
  file.
- The EntryPoint "code + data in parallel" trick collapses for us: a flight
  payload contains no page code (only client references already in the
  bundle), so payload = data and there is exactly one thing to prefetch.
- One live route on web, history as the stack. Stacks are a native concept.
- Modal-over-background becomes a first-class route option instead of a URL
  hack outside the router.

## Route configuration — `app/routes.ts`

The routes file imports app code and must live in the rsc module graph (lazy
loaders, HMR through the import chain), so it is app code: `app/routes.ts`
rather than a lone `cfg/` directory reaching into `app/`.

The API stays close to React Router's data-router builders:

```ts
import { index, layout, route, routes, stacks } from "flypath/router";

const config = routes([
  layout(
    () => import("./shell.tsx"),
    [
      stacks(
        () => import("./tab-bar.tsx"),
        [
          index(() => import("./feed.tsx")),
          route("explore", () => import("./explore.tsx")),
          route("me", () => import("./profile.tsx")),
        ],
      ),
      route("p/:id", () => import("./post.tsx"), {
        presentation: "modal",
        safeArea: false,
      }),
      route("*", () => import("./not-found.tsx")),
    ],
  ),
]);

export default config;

declare module "flypath" {
  interface Register {
    routes: typeof config;
  }
}
```

Builders:

- `routes(children)` — the root wrapper; exists so the tree's literal
  pattern types are captured in one place for URL typing (below).
- `route(pattern, load, options?, children?)` — pattern segments are static,
  `:param`, or `*` splat. Params are inferred from the pattern via template
  literal types and arrive on the page as typed props.
- `index(load, options?)` — matches the parent path exactly.
- `layout(load, children)` — pathless wrapper; receives `children` and the
  matched params. Persists across navigations beneath it.
- `stacks(load, children)` — a navigator node. It declares two things: the
  boundary between persistent chrome and swappable screens, and that each
  direct child subtree is an independent stack rooted at that child's own URL.
  The `load` component is the user's chrome — it renders `children` and draws
  its own switcher (a tab bar, a drawer, a segmented control) from
  `useStacks()`. The framework owns stack behavior and owns none of that UI.

Semantics worth pinning down now:

- Matching is declaration order, first match wins. No specificity ranking.
  Trailing slashes are insignificant.
- Routes declared **under** a stack always render inside that stack. Routes
  declared **outside** `stacks` (like `p/:id` above) are free-floating: on
  native they push onto whichever stack is currently active, exactly how
  Instagram pushes a post onto the tab you tapped it from. Declaration
  position fixes the layout chain; runtime attribution fixes the stack.
- An `<a href>` pointing at a stack's root URL switches to that stack instead
  of pushing a duplicate root screen onto it; re-tapping the active one pops
  it to root. So the app's switcher is plain links, not a special component.
- Options bag (typed, extensible): `safeArea: boolean | Edge[]`,
  `presentation: "push" | "modal"`, `prefetch: "hover" | false`. Route options
  describe navigation behavior only — never presentation. Page titles are a
  plain React 19 `<title>` rendered by the page (see below); switcher labels
  and icons live in the app's own chrome.

## Typesafe URLs

Flypath owns the JSX types (`jsxImportSource: "flypath"`), so the `a`
intrinsic's `href` attribute can be typed against the app's actual route
table instead of `string`.

- Builders preserve pattern literals (`"p/:id"`, not `string`); `routes()`
  captures the whole tree's type, and a type-level join over nesting computes
  every full path. The app registers that type once, TanStack-style, via the
  `declare module "flypath"` / `Register` merge shown above. Without a
  registration everything falls back to `string` and nothing breaks.
- From the registered tree flypath derives `Href`: a union of concrete URL
  template types — for the example config,
  `` "/" | "/explore" | "/me" | `/p/${string}` ``. Dynamic segments become
  `${string}` holes, so both `href("/p/:id", { id })` and an inline
  `` `/p/${id}` `` typecheck, while `/posts/${id}` or a typoed `/explor` are
  compile errors.
- The `href` attribute accepts `Href | ExternalHref`, where `ExternalHref`
  covers `http(s)://`, `mailto:`, `tel:` template types — anchors may still
  leave the app.
- `href()` is the blessed constructor for parameterized URLs, usable
  anywhere — server components, client components, actions:

```ts
import { href } from "flypath/router";

href("/explore");
href("/p/:id", { id: post.id });
```

The pattern argument autocompletes across the route table; the params
object is required exactly when the pattern has dynamic segments, keyed and
typed per segment. Unlike inline interpolation, the helper percent-encodes
param values and joins splat arrays.

- Everything that consumes a URL takes `Href`: `useRouter().push`/`replace`,
  `redirect()`, prefetch APIs. One type, checked end to end.
- Escape hatch if type-level joining gets slow on large trees: the manifest
  extraction (phase 2) already statically evaluates every full pattern and
  could emit a `.d.ts` with the finished union — same surface, zero inference
  cost. Start inference-only; codegen stays optional, never required.

## One tree, two projections

- **rsc env** — `virtual:flypath/routes` re-exports `app/routes.ts` directly:
  the live tree with lazy loaders.
- **client / native envs** — `virtual:flypath/route-manifest`: statically
  extracted with the oxc + `evaluate` infrastructure already used for styles
  (`src/vite/eval.ts`, same contract as `vars.css.ts`): entries of
  `{ id, pattern, safeArea, presentation, stack, boundary }`. Loaders are
  dropped; a route option the static evaluator cannot see is a build error.

The server side also derives **boundaries** from the tree: the root, plus
every navigator node. A boundary is the unit of rendering — "render the
subtree below boundary B for URL U".

## Server side

Replaces the `import.meta.glob` routing in `server-entry.tsx`:

- Match URL → `[layout…, page]` chain; compose
  `<Shell><Chrome><Page params={…} searchParams={…} /></Chrome></Shell>`.
- A `?screen=<boundary>` param (set by native clients) renders only the
  subtree below that boundary. Web and the native shell use the root
  boundary.
- `redirect(to, { permanent })` and `notFound()` throwables usable in server
  components and server actions. Document GETs get real 30x/404 responses;
  flight requests get the status plus an `x-flypath-redirect` header the
  client router follows.
- Flight responses carry an `x-flypath-route` header (`{ id, params }`) so
  clients can confirm what matched (splat/404 handling, post-redirect URL).

## Web navigation runtime

New `src/runtime/router.web.ts`, wired into `web-entry.tsx`:

- Document-level click interception for same-origin `<a>` (skip modified
  clicks, `target`, `download`): `pushState`, fetch flight, swap inside
  `startTransition`. Whole-payload swap; reconciliation keeps client
  component state because layout element types are stable across payloads.
- `popstate`: payload cache keyed by history entry key → instant
  back/forward, refetch on miss. Scroll position saved per entry key and
  restored on pop.
- Prefetch on hover/touchstart for links whose route has `prefetch` enabled —
  warms the same payload cache. One tier only; there is no page code to
  preload.
- Server actions: existing POST flow unchanged; a completed action
  invalidates the payload cache (server state changed); `redirect()` from an
  action navigates via the header.
- `presentation: "modal"`: navigating in-app keeps the previous payload
  mounted as the background and renders the new payload in an overlay — both
  live trees, back closes. A cold GET of the same URL renders it standalone.
  Instagram's background-route behavior, as a declared option.

## Native navigation runtime

Navigator chrome is client-side (new components in `src/components/native/`);
screens are server-driven:

- Boot fetches the root-boundary payload once: the user's root layouts down
  to the navigator client reference (`NativeNavigator`).
  This replaces the single-payload `native-root.tsx` flow.
- Router state: `{ screens: Record<stackKey, ScreenEntry[]>, activeStack }`, or
  a single stack when the tree has no `stacks` node.
  `ScreenEntry = { key, url, routeId, payload }`.
- A screen's content is a flight fetch of its URL at the owning tab's
  boundary, hosted in `<Screen>` with a Suspense fallback and error boundary.
  Screens below the top stay mounted (hidden), so back is instant and
  ScrollView/input state survives.
- `<a href>` with a relative href pushes on the active stack — replacing
  today's `openHref` error path in `primitive.tsx`; absolute hrefs keep
  `Linking.openURL`.
- Push/pop are JS-driven `Animated` transitions (slide on iOS, fade-through
  on Android) — no react-native-screens dependency in v1.
- Android hardware back pops the active stack, then falls back to the first
  stack, then exits. Re-tapping the active stack pops it to root.
- Deep links: `Linking` URL → manifest match → activate owning stack, reset or
  push it.
- Server actions (`native-actions.ts`): after an action, refetch the visible
  screen's payload and invalidate the rest. Same for HMR `rsc-update`.

Hooks for client components on both platforms: `useRouter()`
(`push`/`replace`/`back`/`switchStack`), `usePathname()`, `useParams()`, and
`useStacks()` — the latter returning `{ key, href, active }[]` in declaration
order, so chrome can render a switcher without knowing any of the above.
Server components read `params`/`searchParams` props instead of hooks.

## SafeAreaView

- A framework-level insets TurboModule in the flypath native cores (same
  plumbing plan 5 built, not consumer `"use native"` code): iOS
  `window.safeAreaInsets` + `viewSafeAreaInsetsDidChange`, Android
  `WindowInsetsCompat` (system bars + display cutout) with a listener.
  Surface: `getInsets()` plus a change event.
- `native-root.tsx` provides an insets context and drops today's hardcoded
  `paddingTop: 64`.
- `<SafeAreaView edges?>` exported from `flypath`, usable in server
  components: on native, a View applying context insets as padding for the
  requested edges (a client reference like the other primitives); on web, a
  div padded with `env(safe-area-inset-*)`.
- Route option `safeArea` (default `true`; `false` or an edges array): the
  native `<Screen>` wrapper and the web document wrapper apply it, so
  full-bleed routes (reels-style pages) just declare `safeArea: false`.

## Phases

### Phase 1 — route tree + server matcher

Builders and types, `virtual:flypath/routes`, URL matcher with params and
declaration-order semantics, layout composition, `redirect`/`notFound`, glob
routing removed. Includes the type layer: literal-preserving builders,
`Register`, `Href` derivation, the typed `a` intrinsic, and `href()`. Example
app gains `/p/:id` and a second page; web navigates with full page loads; native
still boots to `/`.

### Phase 2 — manifest extraction

Static extraction to `virtual:flypath/route-manifest` via `eval.ts`,
build-time errors for non-static options, boundary computation, tests over
pattern matching and extraction edge cases.

### Phase 3 — web client router

Link interception, payload cache, back/forward + scroll restoration,
prefetch, action cache invalidation, redirect following. Example: feed → post
without a document load.

### Phase 4 — native stack

Boundary-scoped rendering (`?screen`), `StackNavigator` + `Screen`, push/pop
animations, hardware back, `<a>` push wiring. Example: feed → post pushes on
device with working back.

### Phase 5 — parallel stacks

`NativeNavigator` + `useStacks()`, per-stack screen history, active-stack
attribution of free-floating routes, root-href switching, re-tap pops to root,
deep links. Example: three stacks the app presents as tabs.

### Phase 6 — safe areas

Insets module on both platforms, context in native root, `<SafeAreaView>`,
`safeArea` route option, web `env()` mapping.

### Phase 7 — modal presentation + polish

Modal routes on web (background payload) and native (modal transition),
payload cache tuning, iOS swipe-back spike, scroll-to-top on re-tap at root.

## Key decisions

- Routes are code in one explicit file, `app/routes.ts` — never filesystem
  conventions. React-Router-shaped builders.
- The link primitive stays the `<a>` intrinsic (server components speak DOM),
  no `<Link>` component; navigation behavior comes from route options and
  attributes, not a special component.
- URLs are typechecked end to end: the `href` attribute, the `href()`
  helper, and router APIs all take an `Href` union derived from the
  registered route tree — pure inference, with manifest-emitted `.d.ts` as a
  fallback, never a mandatory codegen step.
- Declaration-order matching, first wins — no specificity ranking to learn.
- Client route knowledge is a statically-extracted manifest; page code and
  loaders never leave the server. No route-resolution round-trip (rejecting
  Comet's `bulk-route-definitions` — our table is small and static).
- Web navigation swaps one root payload per navigation; nested-boundary
  partial rendering is deferred, but the boundary machinery (`?screen`) built
  for native is the seed for it.
- Parallel stacks exist only on native; web is one live route over browser
  history, matching both Comet and browser expectations. `stacks()` still marks
  the chrome boundary on web, where it drives content-only fetches for modals.
- The framework owns navigation behavior, never navigator UI. `stacks()` is
  named for what it does — a chrome boundary plus parallel stacks — not for the
  tab bar an app might draw on top of it. There is no `TabBar` primitive.
- Page titles are a plain React 19 `<title>` rendered by the page, hoisted into
  `<head>` on web and dropped on native (metadata tags resolve to nothing in
  the native intrinsic layer). No `title` route option, so titles can be
  dynamic and are never duplicated in the manifest.
- Native screens stay mounted below the stack top; payload retention is the
  back-gesture cache.
- JS-driven `Animated` transitions in v1; react-native-screens fidelity
  (native gestures, freeze) is a later evaluation, not a dependency today.
- Safe-area insets come from our own tiny native module (plan 5 plumbing), so
  primitives and route options work identically on both platforms.

## Risks / open questions

- Whole-payload web navigations re-render layouts server-side every time —
  fine at this scale, but the nested-boundary follow-up should land before
  apps grow deep shells.
- Cache staleness: back/forward serves retained payloads (Instagram behaves
  the same). Expose `router.refresh()` and pick a retention cap
  experimentally.
- JS-driven stack animations will not match native gesture fidelity (iOS
  interactive swipe-back especially); the phase 7 spike decides whether
  react-native-screens earns its weight.
- Precise rules for `layout` nodes nested inside `stacks` children need to be
  specified during phase 1 before types are frozen.
- React does not dedupe `<title>`: if a layout and its leaf both render one,
  both land in `<head>` and the browser honors the first, so the outer wins
  over the more specific page. Today's rule is "titles belong in leaves"; a
  merge step would be needed to make layout defaults overridable.
- `useStacks()` derives `active` from the manifest's `stack` field, so a
  free-floating route pushed onto a stack (`/p/:id`) reports no active stack on
  web — the switcher de-highlights behind a modal. Native is correct because it
  reads real router state. Fixing web means tracking the background route's
  stack across a modal.
- Only one `stacks()` boundary is honored: `manifest.navigator` takes the first
  non-root boundary, so nested or sibling navigators are not yet supported.
- Template-literal holes are permissive: `/p/${string}` accepts trailing
  junk, so the types catch wrong routes and typos, not malformed suffixes —
  `href()` is the strict path. Also watch checker cost as route counts grow
  (the `.d.ts` escape hatch above).
- Navigation-state persistence across native app restarts is punted.
- Memory pressure from keeping full screens mounted per stack — measure, then
  consider detaching payloads for entries deep in the stack.
