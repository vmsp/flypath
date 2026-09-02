# Flypath — revalidation

## Goal

After a mutation, every screen the user can reach shows what the server
now says — and a mutation costs no more than the request it already
makes.

Today `signOut()` clears the cookie and redirects to `/`, and the `/me`
entry in the profile tab keeps its signed-in payload for the life of the
process. Chrome is worse: a fragment is fetched once per container
(`native-router.ts:164`) and has no refetch path at all, so a tab bar
that renders the visitor's name is stale forever.

The constraint is the interesting half of the problem. The obvious fix —
refetch every mounted screen after every POST — turns one tap into N
server renders of screens nobody is looking at, and it is the reason
this was never fixed by pointing `refresh()` at actions. The design
below exists so that the answer to "what does a mutation cost?" is
**the response it already returns**.

Milestone: sign out from `/me`, land on `/`, tap the profile tab, get
bounced to `/login` by the guard, and see the tab bar redraw for a
signed-out visitor — with **zero requests beyond the action POST and the
one screen fetch the tab tap makes anyway**.

## What is broken today

1. **Nothing on native invalidates.** `applyPayload`
   (`native-router.ts:447`) replaces the payload of the focused screen
   and nothing else. Other stacks, screens below the top, and every
   fragment keep pre-mutation payloads.
2. **The one invalidation path fans out.** `refresh`
   (`native-router.ts:462`) refetches _every_ screen entry in the whole
   tree plus every fragment. It is wired to the HMR socket only
   (`native-root.tsx:234`) — which is exactly right for HMR and exactly
   wrong for a mutation. Plan 10 already names the failure mode: a
   sign-out over a guarded stack produces three redirects, three
   relocations and three payloads.
3. **Web is correct but blunt and eager.** `invalidatePayloads()`
   (`router-web.tsx:165`) clears the snapshot and prefetch maps on every
   action, so back after a mutation stops being instant and blocks on a
   fetch. The seed-then-navigate ordering plan 10 flagged as fragile is
   a symptom of the same thing: a cache that only knows "cleared" cannot
   say _when_ an entry was rendered.
4. **Payloads are promises inside the router tree.** `ScreenEntry.payload`
   is a `Promise<RscPayload>` consumed by `use()` inside a `Suspense`
   boundary (`navigator.tsx:45`, `:151`, `:80`). Replacing one with a
   pending promise outside a transition shows the fallback — and for a
   fragment, the fallback replaces the chrome _and the entire navigator
   subtree it renders_, unmounting every screen, its client state and
   its animation. There is no swap-when-resolved path, which is why
   chrome revalidation was never attempted.
5. **Fetches start inside state updaters.** `navigate` → `ensure` →
   `makeScreen` → `fetchers.screen(...)` all run inside
   `setState(current => …)` (`native-root.tsx:166`). React may call an
   updater more than once; each call issues another request and stores a
   different promise. It works by luck today.
6. **`applyPayload` lands on whoever is focused when the response
   arrives**, not on the screen that ran the action. Navigate during a
   slow action and the result is written into the wrong screen.

(4) and (5) are why this is a plan and not a patch: the fix for (1) is
two lines _if_ the client can replace content without suspending and
without side effects in a reducer.

## Field notes — prior art

Two independent axes, and every framework picks a corner.

_What gets invalidated:_ everything, or a declared subset.
_When it refetches:_ immediately, or the next time someone looks.

- **React Router / Remix** — after a non-4xx/5xx action, _all_ loaders
  for the currently matched routes revalidate automatically, in one
  single-fetch request. `shouldRevalidate` opts a route out per action.
  Everything, immediately — but "everything" is only the routes on
  screen, because Remix has no parallel stacks to be stale behind it.
- **SvelteKit** — a form action runs `invalidateAll()` by default,
  re-running every `load` for the current page. `depends("app:x")` +
  `invalidate("app:x")` narrows it. Rerunning a load updates `data`
  without recreating the component, which is the same
  keep-state-swap-data property we need.
- **Next.js App Router** — the opposite default: nothing invalidates
  unless a Server Action calls `revalidatePath` / `revalidateTag`, and
  the client Router Cache is a second, separate thing that often needs
  `router.refresh()` on top. The famous failure is stale UI after a
  successful mutation, which is the bug we already have.
- **TanStack Query** — the model worth stealing. `invalidateQueries`
  marks matching queries stale; **active** (mounted) ones refetch in the
  background, **inactive** ones are only marked and refetch the next
  time they are used. Stale data stays on screen while the refetch runs.
- **Inertia** — every visit returns the full page props; `only` /
  `except` narrow a reload to named props, and `router.reload()` targets
  the current URL. Partiality is requested by the client, per visit.
- **htmx `hx-swap-oob` / Turbo Streams** — the mutation response carries
  extra fragments addressed by DOM id, so one POST updates the row, the
  counter and the flash. Server-declared partial invalidation; needs
  stable addressable regions.
- **Phoenix LiveView** — the server keeps the render tree per connection
  and pushes diffs. Exact, and unavailable to a stateless HTTP framework
  whose client backgrounds for a week.
- **Relay / Apollo** — normalized records; a mutation returns the changed
  records and only the components reading them re-render. Wrong layer
  for SDUI: our payloads are opaque UI trees, not records.
- **Native apps generally** (React Navigation + Query, and every
  hand-rolled iOS app) — refetch on screen focus and on app foreground.
  Nobody refetches five screens deep in a tab the user has not opened.

The consensus among the ones with parallel stacks (i.e. the native ones)
is **lazy**: invalidate broadly, refetch on visibility. The consensus
among the web frameworks is **eager**, and they get away with it because
there is exactly one screen. Flypath has both shapes, so it should take
the lazy rule and let the eager case fall out of it: on web, "visible"
happens to mean the whole app.

## Options considered

1. **Eager fan-out** — refetch every mounted entry after a mutation
   (Remix's rule, applied to a tree that Remix does not have). N
   requests, N server renders, most of them never seen. Rejected; it is
   what `refresh()` already does and why it is not wired to actions.
2. **Batched fan-out** — one request that renders many `(url, container)`
   pairs into one stream. Fixes the round trips, not the waste: the
   server still renders screens nobody is looking at, and it adds a
   multi-render endpoint. Kept in the back pocket for phase 5 if
   laziness ever proves insufficient.
3. **Tag graph** — `revalidate("posts")` in the action, `depends("posts")`
   in the components (Next's `revalidateTag`, SvelteKit's `depends`).
   Rejected for v1: it costs ceremony on both sides, its failure mode is
   silent staleness when someone forgets a tag, and it optimizes server
   renders that laziness has already deferred to "if the user ever
   looks". There is no data cache underneath for a tag to key, so a tag
   saves a render, not a query.
4. **Out-of-band fragments in the mutation response** (htmx, Turbo).
   Requires addressable regions; RSC has no stable identity below a
   screen. The chrome piggyback below is the 90% of this that flypath
   _can_ address, because containers already have ids.
5. **Epoch + lazy revalidation on visibility** — chosen. Below.

## The model

**One number.** The router holds an `epoch`. Every completed action
increments it. Every piece of content the client holds — a screen
payload, a chrome fragment, a redirect seed, a web history snapshot —
records the epoch it was rendered at. Content whose epoch is behind the
router's is **stale**. Nothing is ever "cleared".

**Three states, not two.**

```
absent   — never fetched, or dropped: suspend on the fetch
stale    — rendered before the current epoch: show it, refetch behind it
fresh    — rendered at the current epoch: do nothing
```

**Stale content is shown, not hidden.** A stale screen keeps rendering
its last known good payload while the refetch runs, and the new payload
replaces it in a transition when it resolves. No spinner, no flash, no
unmount — this is TanStack's stale-while-revalidate and SvelteKit's
"rerunning a load does not recreate the component".

**Only what is visible refetches.** The visible set is computed from the
tree:

- the chrome fragment of every container that is actually rendered — the
  active branch's chain, not hidden branches;
- the top screen of each stack in that chain, plus the screen underneath
  a `presentation: "modal"` entry, recursively;
- nothing else. Ever.

Everything invisible stays stale and refetches when it becomes visible:
a tab switch, a pop, a modal dismissal. That is one request, made at the
moment the user asks to see the screen, and never made at all for
screens they do not return to.

**The action response is the revalidation.** An action POST already
renders the current screen at the new state and streams it back
(`server-entry.tsx:388`). That payload _is_ the fresh content for the
focused screen, and it is stamped at the new epoch. Chrome rides along
in the same response (below). So the on-screen half of a revalidation
costs zero extra requests, and the off-screen half costs nothing until
it is looked at.

That is the whole answer to "if we POST anything, does the user refetch
everything?" — no. A POST costs a POST.

## What the client holds (native)

The router tree stops holding payloads. It becomes pure data:

```ts
type ScreenEntry = {
  kind: "screen";
  key: string;
  url: string;
  container: string;
  safeArea: …;
  presentation: "push" | "modal";
};

type RouterTree = {
  tree: Record<string, ContainerState>;
  epoch: number;
};
```

Which containers have chrome is already in the manifest, so the tree does
not carry a second list of it; `visible()` derives both sets from the
same walk.

Content lives in a second map keyed by content key — `entry.key` for a
screen, `chrome:<id>` for a fragment:

```ts
type Content =
  | { status: "loading"; promise: Promise<RscPayload>; epoch: number }
  | { status: "ready"; node: ReactNode; epoch: number; busy: boolean }
  | { status: "error"; error: unknown; epoch: number };
```

**The driver owns all IO.** `sync(router, content)` computes the visible
set, and for each key: absent → fetch (`loading`); stale → fetch,
keeping the `ready` node with `busy: true`; fresh → nothing. One
in-flight request per key, superseded by request id so an out-of-order
resolution cannot overwrite a newer one. It is called from an effect on
router change, from the action callback, from the HMR socket, and from
`AppState` — never from inside a state updater, which retires (5).

`navigate`, `ensure`, `goBack` and `relocate` lose their `Fetchers`
parameter and become what they always claimed to be: pure functions over
the tree. `refresh` is deleted; bumping the epoch and syncing replaces
it, and HMR gets the same lazy behavior for free — the visible screen
refetches, the other tabs refetch when you open them.

**Content is React state, but the driver owns the master copy.** A store
read through `useSyncExternalStore` cannot be updated inside a transition
by design, and the transition is exactly what keeps a swap from flashing:
the new payload's own streaming `Suspense` boundaries would otherwise
show their fallbacks over already-mounted content. So content reaches the
tree as one `useState` in `Root`, written only through
`startTransition(setContent)`.

The driver cannot read that state — it runs outside React, from the
action callback and from `resync()` after a response lands — so it keeps
its own `content` binding and mirrors it into React through the bridge's
`publish`. **The map therefore exists twice**, and the two copies are
kept in sync by exactly one rule: `publish()` is the only writer of
either. `update()` and `evict()` are the only callers of `publish()`, and
nothing else assigns `content`. A future write path that skips it
diverges silently, and the symptom is a screen rendering one thing while
the driver believes another. Payload roots are stable element references,
so screens whose content did not change bail out of re-rendering.

**One fiber position for content.** `Payload` (`navigator.tsx:45`) keeps
its two call sites and changes only its prop, so both statuses render
from the same component in the same place:

```tsx
function Payload({ content }: { content: Content }): ReactNode {
  if (content.status === "error") throw content.error;
  return content.status === "ready" ? content.node : use(content.promise).root;
}
```

`use()` is reached only while a screen has never rendered. Once ready,
the component returns a node directly and a swap is an ordinary
re-render — the chrome's nested `StackHost` keeps its fiber, its state
and its animations. Rendering `use()` in one branch and a node in
another _from different components_ would remount the subtree; this is
the whole trick, and it is the thing that was missing.

## The protocol

Two headers and one payload field.

**`x-flypath-chrome: <id>,<id>`** (request). The client names the chrome
fragments it wants rendered into this response. The server intersects it
with the chrome containers that are ancestors of the screen it actually
renders — after redirect hops — and ignores the rest.

**`payload.fragments?: Record<string, ReactNode>`** (response). Each
requested fragment, rendered by the existing `renderFragment`
(`router-server.tsx:110`) against the same `RouteInfo` the screen used.

Two things fall out:

- an action POST returns the fresh screen _and_ the fresh tab bar in one
  round trip;
- **cold start drops from two requests to one.** Today boot fires a
  screen fetch and a fragment fetch in parallel (`native-router.ts:164`);
  the client knows the chrome ids from the manifest before it fetches
  anything, so it can just ask for them.

**`x-flypath-revalidate: stale | reset | none`** (response). Absent on an
action response means `stale`. It is the only new response header, and
it exists so the server can escalate or opt out:

- `stale` — bump the epoch. Off-screen content is shown while it
  refetches.
- `reset` — bump the epoch _and drop_ every content entry the response
  did not just refresh. Off-screen screens suspend on next focus instead
  of showing pre-mutation content. This is the sign-out shape: nobody
  should see the previous user's profile for the 80 ms a swap takes.
- `none` — do not bump, and do not re-render: the server skips the
  screen render entirely and returns the action's `returnValue` over a
  `root: null` payload. This is the like button in a feed the client is
  already updating optimistically.

The client bumps only when _it_ made the action request, so screen GETs
and fragment fetches never carry invalidation semantics.

## `revalidate` — the verb

Plan 8 gave navigation one verb. Invalidation gets its second, with the
same shape and the same dotted variants:

```ts
revalidate(); // refresh what is visible, mark the rest stale
revalidate.reset(); // …and do not show what is stale while it refetches
revalidate.none(); // this action changed nothing the UI reads
```

In a **server action** it sets the response header. `revalidate.none()`
must be called before the action returns, since it suppresses the render.
`signOut()` becomes `cookies.clear(...)`, `revalidate.reset()`,
`navigate("/")`.

In a **client event handler** it bumps the local epoch and syncs — the
escape hatch for mutations that did not go through a server action
(a native module wrote to disk, a push notification arrived).

In a **server component** it throws, like `navigate("back")` does during
render: a render that invalidates its own render is a loop.

Every action revalidates by default. Stale UI after a successful
mutation is a correctness bug, and correctness is not opt-in — this is
Remix's and SvelteKit's default, and Next's default is the one that
generates the bug reports. The cost of being wrong in this direction is
bounded by laziness: one refetch, of one screen, at the moment the user
asks for it.

One route option controls how a stale screen behaves, defaulting to the
lazy path:

```ts
route("me", () => import("./profile.tsx"), { revalidate: "blocking" });
```

- `"stale"` (default) — show stale content, swap when resolved.
- `"blocking"` — drop stale content and suspend; for screens where the
  previous render is a privacy problem rather than a stylistic one.
- `"never"` — the route is immutable; ignore the epoch. For a help page
  or an offline-first screen.

`RouteOptions` is extracted generically (`vite/route-extract.ts:122`), so
this is a type change and nothing else.

## What runs when

| event                           | requests | visible screen          | chrome              | elsewhere    |
| ------------------------------- | -------- | ----------------------- | ------------------- | ------------ |
| cold start                      | 1        | fetched                 | in the same payload | —            |
| tap a link                      | 1        | fetched                 | untouched           | untouched    |
| switch to a fresh tab           | 0        | already correct         | untouched           | untouched    |
| switch to a stale tab           | 1        | stale, swapped on load  | untouched           | still stale  |
| pop back to a stale screen      | 1        | stale, swapped on load  | untouched           | still stale  |
| action, no redirect             | 0 extra  | the action's own render | same response       | marked stale |
| action + redirect               | 0 extra  | destination, seeded     | same response       | marked stale |
| action with `revalidate.none()` | 0 extra  | untouched               | untouched           | untouched    |
| `revalidate()` from a handler   | 1        | refetched               | same response       | marked stale |
| HMR `rsc-update`                | 1        | refetched               | same response       | marked stale |
| app returns to foreground       | 0 or 1   | per `staleTime`         | with it             | marked stale |

The row that matters is the sixth. A mutation makes no request it was not
already making.

## Web

Web keeps its shape — one live payload, chrome inside it, history
snapshots — and gains the same stamping.

- `Snapshot` carries `epoch`; `invalidatePayloads()` becomes
  `bump()`, which increments the epoch and drops the _prefetch_ map only
  (speculative, cheap to redo). Snapshots survive.
- `popstate` renders the snapshot immediately as it does today, and if
  `snapshot.epoch < epoch`, refetches behind it and swaps in a
  transition, guarding that `historyKey()` has not changed meanwhile.
  Back after a mutation stops blocking on a fetch — a straight
  improvement over today's clear-everything.
- The seed-then-`invalidatePayloads()` ordering constraint plan 10 flagged
  as fragile disappears: the seed carries the new epoch, so it cannot be
  cleared by something that ran after it. **Stamping beats ordering.**
- `revalidate()` from a handler = `refreshPayload()` + bump.
  `revalidate.reset()` additionally drops the snapshot map, restoring
  today's behavior exactly where it is actually wanted.
- No `x-flypath-chrome`: web's chrome rides in the payload already.

## What changes

- `runtime/native-content.ts` (new) — `Content`, the driver, request
  dedupe and supersession, the seed map (now epoch-stamped rather than
  TTL-stamped), `sync`.
- `runtime/native-router.ts` — `Fetchers` deleted and threaded out of
  `navigate` / `ensure` / `screenAt` / `initialRouter` / `relocate`;
  `refresh` deleted; `visible(router)` added; `epoch` on the tree.
- `components/native/navigator-context.ts` — `ScreenEntry.payload` and
  `RouterTree.fragments` deleted; `epoch` added; `Content` and the
  content map exported for the hosts to read.
- `components/native/navigator.tsx` — `Payload` takes a `Content` instead
  of a promise; `Container` renders chrome content from the same position
  whether it is loading or ready.
- `runtime/native-root.tsx` — the content state, the driver wiring, sync
  on router change, `AppState` foreground.
- `runtime/native-actions.ts` — capture the acting entry's key at call
  time and commit by key (retires bug 6); read
  `x-flypath-revalidate`; hand `payload.fragments` to the store.
- `components/native/router-store.ts` — `applyPayload` becomes
  `commit({ key, payload, revalidate })`, plus `currentKey()`.
- `runtime/router-web.tsx` — epoch on snapshots; background revalidation
  on pop.
- `runtime/server-entry.tsx` — honour `x-flypath-chrome` on any flight
  render; emit `x-flypath-revalidate`; skip the screen render for
  `revalidate.none()`.
- `runtime/payload.ts` — `fragments?: Record<string, ReactNode>`.
- `protocol/headers.ts` — `CHROME_HEADER`, `REVALIDATE_HEADER`.
- `router/revalidate.ts` + `-client` / `-server` — the verb, mirroring
  `navigate.ts` / `navigate-client.ts` / `navigate-server.ts`.
- `router/types.ts` — `RouteOptions.revalidate`.
- `example/app/actions.ts` — `signOut` gains `revalidate.reset()`;
  `postNote` is the stale-tab test.

## Phases

### Phase 1 — content out of the tree

The content map, `Payload` over a `Content`, the driver, `Fetchers`
deleted. No new behavior: same fetches, same timing, same screens.
`refresh()` survives this phase rewritten as "drop every content entry
and re-sync" — still a fan-out, still HMR-only, deleted in phase 2. What
changes is that replacing content no longer suspends the subtree it
lives in, and no fetch is issued from inside a state updater. This is the
phase that makes the rest one-liners, and it is the one to review
carefully — `Payload` occupying a single fiber position in both statuses
is load-bearing.

Acceptance: the example app behaves identically; HMR still refreshes; a
screen pushed while another is in flight does not double-fetch.

### Phase 2 — the epoch

`epoch` on the tree and on every content entry; `visible()`; sync on
every router change. Actions bump it; the action's own payload lands on
the acting entry by key at the new epoch. Off-screen content goes stale
and refetches on visibility.

**This is the phase that fixes the reported bug.** Sign out, tap the
profile tab, get bounced to `/login` — with the guard's redirect landing
through `relocate`, which plan 10 already built.

Acceptance: post a note from the compose modal, dismiss it, and the feed
underneath shows the note after exactly one fetch. Switch to Explore and
back twice: no requests, because nothing invalidated in between.

### Phase 3 — chrome in the response

`x-flypath-chrome`, `payload.fragments`, the ancestor intersection on the
server, and chrome content keyed and stamped like everything else. Cold
start drops to one request; the tab bar redraws after a sign-out with no
request of its own.

Acceptance: `curl` an action POST with the header and see both the screen
and the fragment in one stream; the tab bar's `visitor()` name is correct
after sign-in and sign-out.

### Phase 4 — the verb

`revalidate()` with `.reset()` and `.none()` on both platforms, the
`revalidate` route option, and the web pop path. `signOut` uses `reset`;
one example action uses `none`.

Acceptance: with `revalidate.none()` the network tab shows a POST whose
response has no screen payload and the UI does not move; with `"blocking"`
on `/me` the stale profile never paints.

### Phase 5 — polish

`AppState` foreground revalidation behind a `staleTime` route option;
dev logging of what revalidated and why (the one debugging surface this
design gives away, since nothing is observable in a network log until
the user walks into it); content eviction for entries buried deep in a
stack, which is the memory note plan 6 left open.

## Key decisions

- **Invalidation is broad, refetching is lazy.** Marking is free; a
  request is not. Every framework with parallel stacks lands here, and
  every one without it gets to pretend the two are the same thing.
- **The action response is the revalidation of everything on screen.**
  The POST already renders the current screen; the chrome rides with it.
  A mutation therefore costs nothing beyond itself, which is the
  property the whole design is built to preserve.
- **Stale content stays on screen.** Dropping it would be simpler and
  would flash. `blocking` exists for the cases where showing the
  previous render is a privacy problem, and it is opt-in per route.
- **Every action revalidates by default.** The framework cannot know what
  an action touched, and silent staleness is a correctness bug.
  `revalidate.none()` is the opt-out, and it is cheap to reach for.
- **No tags in v1.** They buy back server renders that laziness has
  already deferred, they need declarations on both sides, and their
  failure mode is silence. Revisit only if profiling shows the lazy
  refetch of a specific screen is the bottleneck — and then a route-level
  `staleTime` is the cheaper answer.
- **Content is React state fed by an external store, not read from one.**
  `useSyncExternalStore` forbids the transition that makes a swap
  flash-free, so the driver pushes into `useState` instead of the tree
  pulling from the driver. The cost is a duplicated map whose single
  invariant is that `publish()` is its only writer.
- **One owner for the epoch.** The driver's module-level `epoch` is the
  authority; `RouterTree.epoch` is a mirror that exists only so a bump
  produces a new router object and re-fires the sync effect. `sync()`
  stamps from the driver's counter, never from the tree's, so a response
  landing mid-transition cannot score stale content as fresh.
- **The router tree is pure data.** Fetching from inside a state updater
  worked by luck; the driver is where IO belongs, and it is also where
  dedupe, supersession and the seed map naturally live.
- **Stamping beats ordering.** Every cached thing records the epoch it
  was rendered at, so "seed after invalidate" stops being a rule anyone
  has to remember.
- **HMR is just an epoch bump.** The refresh-fan-out that plan 10 flagged
  as a risk stops existing rather than getting a special case.

## Risks / open questions

- **The stale window on a guarded screen.** Between tapping a tab and the
  guard's redirect landing, the previous user's screen is on display.
  `revalidate.reset()` and `revalidate: "blocking"` both close it, but
  both are opt-in, and an app that forgets both has a real, if brief,
  leak. Deriving "guarded" from the manifest was considered and rejected:
  every route carries the root `request` middleware, so the derivation
  would be true everywhere.
- **Chrome still sees the URL it was fetched with.** `renderFragment`
  scopes the fragment to the request's `RouteInfo`, so `params()` and
  `query()` inside a tab bar are frozen at fetch time — pre-existing, and
  this plan does not fix it. Keying chrome by `(id, url)` would fix it
  and cost a fetch per navigation, which is worse. The real fix is
  serving the chrome's route scope from client state, which is a
  separate plan.
- **An action fired from a screen that is not focused** still renders the
  focused screen. The modal case is fine (the modal is focused), but a
  timer in a screen under a modal would revalidate the wrong entry.
  Fixing it needs the acting screen's key to reach `setServerCallback`,
  which means threading a screen context through the native form
  primitives.
- **`revalidate.none()` and a redirect are contradictory.** An action
  that opts out of revalidating and then navigates leaves the
  destination's freshness ambiguous. Proposal: `navigate` wins, `none` is
  ignored, and dev warns.
- **Sequential staleness on a deep pop.** Popping through three stale
  screens issues three requests, one per pop. That is correct and lazy,
  but it is three round trips a user can feel on a slow link. A
  prefetch-on-pop-gesture would help and is not in this plan.
- **The visible set is computed, not observed.** It is derived from the
  tree rather than from what actually mounted, so a container the app
  hides itself (a custom chrome that renders `null`) would still count as
  visible. Acceptable while chrome is the only thing between a container
  and the screen.
- **Nothing is observable until it happens.** The lazy design means a
  network log after a mutation is empty, and the request appears
  minutes later when the user opens a tab. The dev logging in phase 5 is
  not optional polish; it is the only way to debug this.
