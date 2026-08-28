# Flypath — navigation containers

## Goal

Replace plan 6's single `stacks()` node with a small vocabulary of nesting
containers, so that the three shapes real apps ship are all expressible in
one route tree:

- a plain pushed stack;
- Instagram/X tabs, where every tab owns its stack and a detail route rides
  whichever tab you opened it from;
- WhatsApp, where the whole tab view is one screen of an outer stack and a
  pushed screen covers the tab bar.

The route file stays the single explicit source of topology. The server
still owns all UI; the client owns navigation state and chrome only.

Milestone: the example app grows a fourth route that pushes _above_ the tab
bar and keeps `/p/:id` riding the active tab, with both behaving identically
on web and native.

## What plan 6 got wrong

`stacks()` fuses three unrelated jobs into one node: a chrome boundary, a
set of parallel branches, and the only place screens may live. That fixes
the topology at two levels, and the runtime hard-codes the assumption:

- `src/runtime/router-server.tsx:31` and `src/vite/route-extract.ts:200`
  both take the **first** non-root boundary as _the_ navigator.
- `src/runtime/native-root.tsx:42` types state as
  `Record<stackKey, ScreenState[]>` plus one `activeStack` — a flat list of
  sibling stacks, by construction.
- `src/runtime/native-root.tsx:88` attributes free-floating routes at
  runtime: `matched?.route.stack ?? activeStack`.

So there is no outer stack to push above, and every route either belongs to
a branch or rides the active one. The third shape is unreachable.

The same rule already produces a platform split. `/p/:id` is declared
outside `stacks()`, so on **web** its chain is `[shell]` and the tab bar
disappears; on **native** it is pushed inside `NativeNavigator`, which
renders inside `<TabBar>`, so the tab bar stays. `presentation: "modal"`
inherits the bug: the native overlay is drawn inside the content area,
under the tab bar.

The root cause is plan 6's own rule — _"declaration position fixes the
layout chain; runtime attribution fixes the stack"_. Those two must be the
same thing.

## Field notes — prior art

- **go_router** is the closest analogue: config-based routing, not a
  component tree. It needs `GoRoute`, `ShellRoute` (shared chrome, no
  branching — our `layout`), and `StatefulShellRoute` with
  `StatefulShellBranch`, which "creates separate Navigators for each of its
  nested branches (i.e. parallel navigation trees)". Branches are explicit
  container nodes; routes declared outside the shell push above it and
  cover the bottom bar.
- **React Navigation** gets the WhatsApp shape from nesting alone: with a
  tab navigator inside a stack's initial screen, "new screens cover the tab
  bar when you push them". It warns that deep nesting makes deep links and
  navigation hard to follow — an argument for keeping the container tree
  shallow and explicit, not for avoiding it.
- **Expo Router** is the cautionary tale, and it is exactly the Instagram
  case. Sharing a detail route across tabs needs array-syntax directories,
  `(home,search,profile)/[user].tsx`, because group segments are not part
  of the URL, so every shared route matches the same URL and the current
  group selects between them. A cold link has no current group, so it
  "renders the first alphabetical match" — their docs warn against relying
  on it. Pushing above the tab bar requires duplicating the URL segment
  outside the tab group.
- **SwiftUI** is the interesting counterexample: the container is a view,
  but the stack itself is _data_ (`NavigationPath`) and destinations are a
  type-to-view map, not a URL tree. It separates the two trees rather than
  deriving one from the other — the principle we want, which config already
  gives us.
- **x.com and instagram.com** carry no container topology at all.
  `history.state` is `{ key: "initial" }` on Instagram (matching plan 6's
  field notes) and `{ key }` on X: one browser history stack, one key per
  entry. Parallel stacks are purely a native concern, so none of this
  machinery reaches the web runtime.

The consensus is that two nesting container kinds are required, and that
everyone who ties URL structure to container structure pays for it. Flypath
does not have to: its URL tree and its container tree can be the same
literal tree without the URL inheriting container segments.

## The model

Containers nest freely, and **declaration position is the single source of
truth for both chrome and push target**.

- `layout(chrome, children)` — pathless wrapper. Transparent to placement,
  no boundary, may be a server component.
- `stack(children)` — LIFO container. Routes declared in it push onto it.
- `parallel(chrome, branches)` — N branches, one active, each retaining its
  own state. The chrome renders `children` and draws its own switcher.

Every route gets a **placement**: the container chain from the root down,
with a branch index per `parallel`, or `*` when the route is shared. It is
computed statically, so the client never needs a round-trip to know where a
URL lands.

Navigation stops being "push onto the active stack" and becomes a **diff
between the current container tree and the target placement**: walk root to
leaf, activate each branch along the way, push at the last container. Back
pops the deepest container in the current chain, then its parent — the
UIKit rule.

### Branches and shared routes

A child of `parallel` that is a container is a **branch**. A child that is
a route, an index, or a layout is **shared**: it renders inside the
parallel node's chrome and lands in whichever branch is active. A branch
has independent history, which is what a container _is_, so the
distinction is structural rather than a marker. A `parallel` with no
container children is a build error.

This is strictly better than the prior art: a shared route is one
declaration, not N copies, so a cold load is never ambiguous about which
page to render — only about which branch sits underneath it, which defaults
to the first.

## Route configuration

Plain stack — no container node needed, an implicit root stack as today:

```ts
routes([
  layout(
    () => import("./shell.tsx"),
    [index(() => import("./home.tsx")), route("a", () => import("./a.tsx"))],
  ),
]);
```

Instagram — per-tab stacks, the post rides the tab you tapped it from and
keeps the tab bar on both platforms:

```ts
routes([
  layout(
    () => import("./shell.tsx"),
    [
      parallel(
        () => import("./tab-bar.tsx"),
        [
          stack([index(() => import("./feed.tsx"))]),
          stack([route("explore", () => import("./explore.tsx"))]),
          stack([route("me", () => import("./profile.tsx"))]),
          route("p/:id", () => import("./post.tsx")),
        ],
      ),
      route("*", () => import("./not-found.tsx")),
    ],
  ),
]);
```

WhatsApp — the tab view is screen 0 of an outer stack, and the pushed
screen covers the tab bar on both platforms:

```ts
routes([
  layout(
    () => import("./shell.tsx"),
    [
      stack([
        parallel(
          () => import("./tab-bar.tsx"),
          [
            stack([index(() => import("./chats.tsx"))]),
            stack([route("calls", () => import("./calls.tsx"))]),
          ],
        ),
        route("chat/:id", () => import("./chat.tsx")),
        route("settings", () => import("./settings.tsx")),
      ]),
      route("*", () => import("./not-found.tsx")),
    ],
  ),
]);
```

## Semantics

- Matching stays declaration order, first match wins; trailing slashes
  insignificant. Container nodes are pathless and contribute no segment.
- Containers are boundaries; layouts are not. **A layout above a container
  is persistent chrome, fetched once. A layout below it is part of each
  screen's chain and re-renders per screen.** This settles plan 6's open
  question about layouts nested inside navigator children.
- `stack()` takes no chrome argument. A stack header is
  `layout(header, [stack([...])])` — persistent above the stack, reading
  `useStack()` for depth and back. The asymmetry is honest: a `parallel` is
  useless without a way to switch branches, a stack is not.
- A link to a branch's root URL activates that branch instead of pushing a
  duplicate root; re-tapping the active one pops it to root. Unchanged from
  plan 6, and still plain `<a href>`.
- `presentation: "modal"` means presented **above its own container**.
  Declared in the outer stack it covers the tab bar; declared under
  `parallel` it does not. The current native behaviour — an overlay drawn
  inside the content area regardless — goes away.
- A deep link resolves to a placement, activates the branches along the
  chain, and seeds each stack beneath the target with its root screen so
  back works from a cold start. A shared route with no active branch yet
  defaults to the first branch.
- Options bag is unchanged: `safeArea`, `presentation`, `prefetch`. Route
  options still describe navigation behaviour only.

## One tree, two projections

- **rsc env** — `virtual:flypath/routes` re-exports `app/routes.ts`
  unchanged.
- **client / native envs** — `virtual:flypath/route-manifest` gains a
  container table and loses the single navigator:

```ts
type Container = {
  id: string;
  kind: "stack" | "parallel";
  parent: string | undefined;
  branches: string[];
  root: string;
};

type ManifestRoute = {
  id: string;
  pattern: string;
  options: RouteOptions;
  placement: string[];
};
```

`placement` is the container chain from root to leaf; the last entry is the
push target, or `"*"` when the route is shared and resolves to the active
branch at runtime. `manifest.navigator: string` (`src/router/manifest.ts:25`)
and `route.boundary` / `route.stack` all disappear.

## Server side

- `flatten()` emits the container table and a placement per route instead
  of `boundary` + `stack`, keeping the per-container ancestor chains it
  already computes.
- `resolveTree` (`src/runtime/router-server.tsx:24`) stops picking the
  first boundary. `renderChrome` becomes
  `renderFragment(containerId, url, params)`: render the layout chain
  between the container's parent boundary and the container itself, hosting
  `<StackHost id>` or `<ParallelHost id>` inside it, wrapped in a scope
  provider so the chrome can read which container it belongs to.
- The screen request keeps today's shape: render the chain below a given
  container for a URL.
- `x-flypath-screen: "chrome"` becomes `x-flypath-fragment: <containerId>`
  and **carries the real URL**. `src/runtime/native-root.tsx:122` currently
  hardcodes `fetchPayload("/", "chrome")`, which silently breaks any layout
  above a navigator that reads params — a latent bug today, fatal once
  containers can sit under `/user/:id`.

## Native runtime

- Router state becomes recursive instead of flat:

```ts
type Entry =
  | { kind: "screen"; key: string; url: string; payload: Promise<RscPayload> }
  | { kind: "container"; key: string; id: string };

type ContainerState =
  { kind: "stack"; entries: Entry[] } | { kind: "parallel"; active: number };
```

- `NativeNavigator` splits into `StackHost` and `ParallelHost`, which
  recurse into each other. A stack entry may be a nested container, which
  is how the tab view sits at the bottom of an outer stack with all its
  branch state retained underneath a pushed screen.
- Navigate = reconcile the placement top-down. Back = pop the deepest
  container in the current chain, falling through to its parent, then to
  the first branch, then exit.
- Screens below a stack top stay mounted, as today.

## Web runtime

Web has no containers; `stack` and `parallel` degrade to chrome, and the
chrome that renders for a URL falls straight out of its layout chain — the
tab bar disappears for a route placed above the `parallel` node, and stays
for one placed under it, with no extra rule.

- `src/runtime/router-web.tsx:69` stops reaching for `manifest.navigator`
  and fetches a modal at its own container.
- The active branch for a shared route is remembered per history entry.
  This closes plan 6's open question about the switcher de-highlighting
  behind a modal.

## Hooks

- `useBranches()` replaces `useStacks()`, scoped to the nearest enclosing
  `parallel` through the scope provider, returning
  `{ key, href, active }[]` in declaration order.
- `useStack()` is new: `{ depth, canGoBack, back }`, so a header layout can
  draw a back button without knowing the tree.
- `usePathname()`, `useParams()`, `useSearchParams()` unchanged.

## Phases

### Phase 1 — container tree

`stack()` and `parallel()` replace `stacks()`; `flatten()` emits the
container table and placements; `Under`/`Declared`
(`src/router/types.ts:75,89`) recurse through the new pathless nodes;
build-time validation for a `parallel` with no container branches. Tests
over placement computation and the branch/shared rule.

### Phase 2 — manifest and extraction

`route-extract.ts` learns the new builders; the manifest carries containers
and placements; `manifest.navigator` is deleted. Tests over extraction edge
cases.

### Phase 3 — server fragments

`renderFragment(containerId, url, params)`, `x-flypath-fragment`, the scope
provider, and the parameterized-layout fix. Web still renders whole
documents, so this phase is verifiable through the web build alone.

### Phase 4 — native containers

Recursive router state, `StackHost` + `ParallelHost`, placement reconcile,
back through nested containers, deep links. Example app: `/p/:id` pushes
inside the active tab, a second route pushes above the tab bar.

### Phase 5 — web parity

Modal fetched at its own container, active branch remembered per history
entry, `useBranches()` / `useStack()`.

### Phase 6 — presentation

`presentation: "modal"` presented above its own container on both
platforms, replacing the in-content overlay.

## Key decisions

- Two container kinds, freely nested, in the route config — matching
  go_router, which is the only comparable config-based router. Not the
  component tree: that would cost the static manifest (`route-extract.ts`
  reads one file), the `Href` type derivation, and the client's ability to
  know a push target before the payload arrives. The part that genuinely
  benefits from being components — the chrome — already is.
- Declaration position determines chrome _and_ push target. Plan 6's split
  between the two is deleted, along with the web/native inconsistency it
  caused.
- `layout` stays. Containers are boundaries with a per-container fragment
  fetch, retained client state and client chrome; a layout is free and may
  be a server component. Folding them together would make every wrapper a
  boundary and a push target, and would remove the only way to say
  "wrapper that re-renders per screen".
- Branches are containers; a plain route under a `parallel` is shared. No
  `shared()` marker, no duplicated declarations, no alphabetical cold-link
  tiebreak.
- `parallel` rather than reusing `stacks`: `stack` and `stacks` differing by
  one letter while meaning opposite things is a reading hazard.
  `switcher` / `branches` would serve equally well.
- Parallel stacks remain native-only; web is one live route over browser
  history, as X and Instagram both are.

## Risks / open questions

- A container nested under a parameterized route (`/user/:id` with per-user
  tabs) needs one instance per matched params. Punted: v1 treats each
  container node as a single instance, and the parameterized case is a
  documented limit rather than a silent wrong answer.
- Deep nesting costs a fragment fetch per container on cold start. Shallow
  trees are the norm, but the boundary count is now app-controlled in a way
  it was not before — worth measuring before phase 6.
- `modal(stack([...]))` — a modal that owns a stack, for a settings sheet
  with drill-down — is the natural next container and is deliberately not
  in this plan.
- The branch/shared rule is the one piece of cleverness. It is structural
  and enforceable, but it is a rule readers must learn; the build error for
  a branchless `parallel` is what keeps it discoverable.
- Memory pressure from screens mounted across several retained branches is
  unchanged from plan 6 and still unmeasured.
- Navigation-state persistence across native app restarts is still punted,
  and is harder now that state is a tree rather than a flat map.
