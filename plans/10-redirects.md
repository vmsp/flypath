# Flypath — redirects

## Goal

Make a server-side redirect a first-class navigation on every platform,
answered in one round trip. A guard that calls `navigate("/login")` should
leave the client standing on `/login` — its URL, its container, its
presentation, its safe area — with the login payload already in hand and
no second request.

Milestone: tapping the guarded Profile tab on iOS lands on `/login` with
`currentUrl() === "/login"`; signing in POSTs to `/login`, sets the
cookie, and the redirect to `/settings` renders in the same response;
`curl -D - -H 'x-flypath-platform: ios' .../settings` returns 200 with a
flight body, not a 204.

## The bug, stated generally

The reported symptom is that a guarded login is unescapable on native.
The cause is two independent facts that only combine into a trap:

**The native client decides a screen's identity from the URL it asked
for.** `makeScreen` (`runtime/native-router.ts:34`) stamps `url`, and
reads `safeArea` and `presentation` out of `matchManifest(url)`
(`:39`), synchronously, at creation time. `navigate` picks the container
from `matchManifest(url).placement` (`:174`), also before the fetch. The
payload arrives later as an opaque promise inside the entry, and nothing
about it is ever compared to those four decisions.

**The native transport hides redirects.** `fetchPayload` sees
`x-flypath-navigate` and recursively fetches `command.to`
(`runtime/native-root.tsx:65`), returning the destination's payload from
a call that was asked for the original URL. So nothing ever contradicts
the first fact.

Either alone is survivable. Web has the first — `history.pushState(path)`
is also a client-side guess — but not the second: `request` returns
`{ command }` unfollowed (`runtime/router-web.tsx:99`) and the caller
runs a real `navigate(to, mode)` (`:347`), which corrects the guess. Native
has both, so the guess is never corrected and the entry is permanently
mislabelled.

And it is mislabelled in four ways, not one. `/me` lives in the profile
tab's stack; `/login` is its uncle in the root stack with
`safeArea: ["top"]`. Today's redirect produces a screen **in the profile
tab's stack**, with **the profile tab's manifest options**, labelled
**`/me`**, rendering **`/login`**. The URL is the one that bites —
`currentUrl()` (`native-root.tsx:145`) feeds every action POST
(`native-actions.ts:22`) straight back into the guard — but fixing only
the URL would leave a screen in the wrong container.

So "web is correct and is the model to copy", which is what the TODO
says, is half right. Copying web fixes the URL, keeps the second round
trip, and never states the rule that would have prevented this.

## What is missing today

**Nothing tells the client what the server rendered.** `handler` already
emits a header for it — `x-flypath-route` with `{ id, params }`
(`runtime/server-entry.tsx:268`) — and **nothing anywhere reads it**.
The slot exists, it is unused, and it is missing the one field that
matters: the URL.

**A redirect is an empty answer.** `navigateResponse` returns a 204 whose
only content is "go ask for `/login` instead" (`server-entry.tsx:161`).
At the moment the guard throws, the server has the tree, the chain, the
store and the destination in memory, and it discards all of it. The
sequence is: request `/me` → empty → request `/login` → payload. Two
round trips before a byte of UI, on the path where the user is being told
no. Native pays this on every screen of a push; web pays it on every
transition.

**A redirecting action loses its return value.** Both callbacks bail to
`undefined` the moment they see a command — `web-entry.tsx:34`,
`native-actions.ts:37`. `signIn` returns `void` so nobody has noticed,
but "mutate, then redirect, and tell me what happened" is not currently
expressible on either platform.

## Field notes — prior art

- **Inertia.js** is the exact shape flypath needs, and has shipped it for
  years. Every response is a page object, and `url` is one of the four
  fields present on **every** one of them: `{ component, props, url,
  version }`. The client's history entry comes from `page.url`, never
  from what it requested. Redirects are followed **on the server** — the
  adapter re-dispatches internally — so a guard costs one round trip and
  the client learns the destination from the payload it already has. The
  two cases it cannot follow internally get an explicit escape: a
  cross-origin destination returns `409 Conflict` with `X-Inertia-Location`
  and the client does a full `window.location` visit.
- **Next.js App Router** does the same for server actions. The response
  to an action carries `actionResult`, `actionFlightData`,
  `redirectLocation` and `redirectType` together: the mutation, the
  redirect and the destination's render arrive in one Flight stream. For
  document navigations it emits a real 3xx and lets the browser follow —
  the split flypath should copy.
- **Turbo Drive** resolves a redirect into a visit to the *final* URL:
  a form POST that 303s becomes `Turbo.visit("/redirected_to_here",
  { action: "advance" })`. The history entry is the destination's, and
  the mechanism the app sees is an ordinary visit.
- **React Router 7 / Single Fetch** converts 3xx into a 202 carrying the
  redirect in a turbo-stream body, and the client performs a real
  navigation. Correct, but the destination's data is not in that
  response, so it still costs the second round trip.
- **Server-driven UI on native** (the Airbnb/Lyft lineage) never lets the
  client infer screen identity from the request: the response names the
  screen. It is the same rule as Inertia's `url`, arrived at from the
  other direction, and it is the one flypath's native router breaks.

The consensus is unanimous and flypath is the outlier: **the response is
the authority on which URL it represents.** The fast half of the
consensus — Inertia always, Next for actions — adds: **and the
destination's payload rides along with the redirect.**

## The model

Two rules, and everything below is mechanism.

**A screen's URL is whatever the server says rendered it.** The URL the
client asked for is a guess. It is a good guess, it is worth acting on
immediately so a push animates without waiting, but it is not committed
until a response confirms it. This is Inertia's `page.url` and it is the
rule that makes the native bug unrepresentable rather than fixed.

**A redirect is a navigation the client performs, never one the transport
hides — but the payload rides along, so performing it is free.** The
client does a real `navigate(to, mode)`: history moves on web, placement
is recomputed on native, the container and presentation come out right.
It just never has to fetch, because the answer came with the redirect.

The two rules are complementary: the first says the client must be told,
the second says telling it costs nothing.

## The protocol

One header changes meaning, one changes payload, and the pairing of the
two is the whole wire format.

`x-flypath-location` — the renamed, extended `x-flypath-route`. Emitted
on **every** flight response, and it is what the client commits:

```
x-flypath-location: {"url":"/login","container":"root","route":"login","params":{}}
```

`container` is there because it is the cache key, not because it is an
instruction: it names the scope the payload was rendered for, so the
client can tell whether the payload it was handed fits the place it
decided to put the screen. `route` and `params` are what the header
already carried. Nothing reads the header today, so the rename is free.

`x-flypath-navigate` — unchanged in shape, changed in company:

| response                       | meaning                                    |
| ------------------------------ | ------------------------------------------ |
| 200 + flight body, no navigate | you got the URL you asked for              |
| 200 + flight body + navigate   | go to `to` with `mode`; here is its payload |
| 204 + navigate, no body        | go to `to`; you will have to fetch it      |
| 307 / 308 + `location`         | web document — the browser follows         |

The 204 stops being the redirect mechanism and becomes the degenerate
form of it, kept for the three cases that genuinely have no payload:
`kind: "back"` (there is nothing to render), a destination that is
cross-origin, and a redirect budget that ran out. The client's existing
"there is a command" branch already knows what to do with all of them.

## The server follows its own redirect

`handler`'s body — everything inside `runWithRequest` — becomes
`dispatch(pathname, search, phase, container)`, and `handler` loops over
it:

```
hop 0: dispatch("/me", …, "action")   -> redirect("/login", "replace")
hop 1: dispatch("/login", …, "render") -> Response
answer: hop 1's response + x-flypath-navigate from hop 0
```

Six details carry the weight:

**The destination's own chain runs.** A hop is a full re-dispatch:
re-match, re-`runMiddleware`, re-render. Rendering `/login` inline
*without* re-running the chain would let a redirect land on a route
whose guards never fired, which is an auth hole rather than an
optimization. It is the same reason middleware follows the URL rather
than the rendered subtree (plan 9).

**`outgoing` accumulates across hops.** A guard that sets a cookie and
then redirects keeps the cookie.

**A `Set-Cookie` written on hop N is visible as `Cookie` on hop N+1.**
This is the one place internal following can silently diverge from HTTP,
and it is load-bearing for the example app, not a nicety: `signIn`
(`example/app/actions.ts`) does `cookies.set(SESSION_COOKIE, …)` and then
`navigate("/settings")`, and `/settings` is guarded by `auth`, which
reads `cookies(SESSION_COOKIE)`. With a real HTTP redirect the browser
sets the cookie and sends it back. Without the merge, hop 1's guard sees
no session and bounces to `/login`, and the login is still broken — just
differently.

**Each hop gets a fresh context store.** The values on `RequestInfo.context`
belong to the chain that set them; carrying `session` across a hop whose
chain never ran is the same hole in miniature.

**The action runs on hop 0 only.** Hops 1+ are `phase: "render"` with no
body and no `x-rsc-action`, and the action's `returnValue` / `formState`
are attached to the final hop's payload — the `actionResult` +
`actionFlightData` pairing Next already ships. The redirecting action
stops losing its return value as a side effect.

**A redirect hop renders for the destination's declared container.** The
client asked for `/me` inside `tab-me`, and `renderMatch` skips
`resolved.containers.get(container).ancestors`. Rendering `/login`
against `tab-me`'s skip set would omit layouts `/login` needs, so a hop
drops the requested container and uses `declaredContainer` of the
destination's placement (`router/manifest.ts:49`). That is exactly what
the location header then reports.

**Documents keep the real 307.** A web document navigation still gets
`navigateResponse`'s 3xx: it is one extra round trip that the browser
pays, and in exchange the URL bar, the back button and every crawler are
correct for free. Only flight and native requests take the internal path.

**Budget five hops.** On exhaustion, dev throws naming the cycle
(`/me → /login → /me → …`), which is the most common middleware bug and
deserves a sentence rather than a hang; prod falls back to the 204 so the
client decides.

## The client — one mechanism, two platforms

Both platforms already have, or trivially gain, a payload cache keyed by
`(container, url)`. The redirect's inlined payload is **seeded into that
cache**, and then the client performs an ordinary navigation, which hits
it. Nothing about navigation learns that redirects exist.

That framing is what keeps this honest rather than clever: the seeded
payload is a *hint*, exactly like a hover prefetch. If the client's own
placement resolves to a different container than the one the header
names — possible when a placement ends in `SHARED` and the live branch
differs from the declared one — the key misses and it fetches normally.
Slow path, still correct, and only reachable in the case the server
cannot predict.

### Web

`request` (`router-web.tsx:99`) returns `{ command, payload }` instead of
one or the other. The caller (`:341`) seeds and recurses:

```
invalidatePayloads();
if (result.payload) seed(command.to, containerFromHeader, result.payload);
await navigate(command.to, command.mode);
```

Order matters — the seed goes **after** `invalidatePayloads()`, or it is
cleared before it is read. The rest of `navigate` is untouched: history,
scroll, branches and modal handling all run exactly as they do for a
click.

### Native

`fetchPayload` stops recursing. Screen fetches resolve to
`{ payload, command, location }`, and the router — not the transport —
acts on it. The entry that was created optimistically is corrected by
key, and entry keys are already stable (`nextKey`, `native-router.ts:28`):

`relocate(key, to, mode, payload)`

1. **If the entry is gone, drop everything.** The user pressed back or
   navigated away while the fetch was in flight; a redirect must not
   resurrect a screen they left.
2. **If the destination resolves into the same container, patch in
   place.** Same key, new `url`, `safeArea` and `presentation`, payload
   from the response. The push animation that already started completes
   into the right screen with no flicker. This is the common case —
   a guard redirecting within a stack.
3. **Otherwise, remove the stale entry and run
   `navigate(router, to, "replace", fetchers)`.** Placement, container,
   presentation and safe area are recomputed from the real URL, and the
   fetch it would issue hits the seeded cache.

The redirect always **replaces** the pending entry rather than pushing
over it, and that is not a special case: the user was never on `/me`, so
there is nothing to go back to. The `mode` on the command still matters,
but for the other call site.

Action redirects keep the shape they have today
(`native-actions.ts:33`) — `api.go(command.to, command.mode)`, the
current screen stays, mode decides push or replace — and gain two lines:
seed the cache first, and `return payload.returnValue` instead of
`undefined`.

`currentUrl()` needs no change. It becomes correct because the entry it
reads becomes correct.

## What runs when

| request                             | on redirect                                  |
| ----------------------------------- | -------------------------------------------- |
| web document `GET`                  | 307, browser follows, one extra RTT           |
| web flight (`__flight=1`)           | 200 + payload + navigate, seeded, one RTT     |
| web action `POST`                   | same, plus `returnValue` on the payload       |
| native screen fetch                 | 200 + payload + navigate, entry relocated     |
| native action `POST`                | same, plus `api.go` and `returnValue`         |
| native fragment fetch               | dev error — chrome must not redirect the app  |
| hover prefetch                      | 200 + payload + navigate, both cached         |

The fragment row is the one new restriction. A fragment renders a
container's chrome for the URL the user is already standing on, whose
guard has already passed; a redirect from there means a guard that is not
idempotent, and following it would have the tab bar navigating the app.
Dev throws with the offending container named.

The prefetch row is a quiet improvement: hovering a guarded link now
caches the redirect *and* its destination, so the click is instant
instead of costing two round trips at the worst possible moment.

## What changes

- `runtime/server-entry.tsx` — `handler`'s body extracted to `dispatch`;
  the hop loop; cookie merge between hops; `x-flypath-route` becomes
  `x-flypath-location` with `url` and `container`; `navigateResponse`
  reduced to the no-payload cases.
- `runtime/router-web.tsx` — `request` returns command *and* payload;
  the caller seeds `prefetched` before recursing.
- `runtime/native-root.tsx` — `fetchPayload` stops following; `relocate`;
  the seeded payload map.
- `runtime/native-router.ts` — `relocate`'s two paths (patch in place,
  re-place); `makeScreen` reads the seed before fetching.
- `runtime/native-actions.ts`, `runtime/web-entry.tsx` — seed, then
  `return payload.returnValue`.
- `runtime/payload.ts` — nothing. The location travels as a header, not
  in the payload, because the client needs it before the flight stream is
  decoded.

Nothing is deleted except the recursion in `fetchPayload`, which is the
bug.

## Phases

### Phase 1 — the location header

`x-flypath-location` on every flight response. Web reads it and commits
that URL rather than the path it requested. No behavior change on any
existing path; it makes the invariant checkable and the wire format
inspectable with `curl`.

### Phase 2 — native stops following

`fetchPayload` surfaces the command; `relocate` corrects the entry by
key. **This alone fixes the reported bug** — still two round trips, but
the URL, container, presentation and safe area are all right, and the
login is escapable. Correctness lands before the optimization so the
optimization is never load-bearing for it.

### Phase 3 — the server follows

`dispatch` + the hop loop + the cookie merge + inlined payloads + the
seeded caches on both clients. Both platforms drop to one round trip.
`signIn`'s `cookies.set` → `navigate("/settings")` works end to end,
which is the phase's real test.

### Phase 4 — polish

Redirect budget with a named cycle in dev; the fragment-redirect error;
`returnValue` through a redirect on both platforms; cross-origin
`navigate` falling back to the 204. Android cookie verification, carried
over from plan 9 phase 4.

## Key decisions

- **The response is the authority on which URL it represents.** Every
  flight response names its URL and the client commits that, never the
  one it asked for. This is Inertia's `page.url`, and it is what makes
  the class of bug unrepresentable rather than patched.
- **A redirect is a client navigation with the payload attached.** Not a
  transport-level follow (native today, which loses the URL) and not an
  empty command (web today, which costs a round trip). The client runs
  the same `navigate` a click runs; the payload is seeded into the cache
  it would have fetched into.
- **The seeded payload is a hint, not a contract.** Keyed by
  `(container, url)` and allowed to miss, so a placement the server could
  not predict degrades to a fetch instead of rendering the wrong scope.
- **A redirect hop is a full re-dispatch.** The destination's middleware
  runs. Inlining a render without its chain would be an auth hole, which
  is the same reason plan 9 has middleware follow the URL rather than the
  rendered subtree.
- **Cookies written on a hop are readable on the next one.** Otherwise
  internal following and HTTP following disagree, and the disagreement
  lands precisely on login flows.
- **Web documents keep the real 307.** The browser's redirect is one
  round trip that buys a correct URL bar, back button and crawler for
  free. Only flight requests take the internal path.
- **A screen-fetch redirect replaces the pending entry; an action
  redirect honours `mode`.** The user was never on the guarded URL, so
  there is nothing to go back to; the user *was* on the page that ran the
  action, so there is.
- **The 204 stays, for the three cases with no payload:** `back`,
  cross-origin, and budget exhausted.

## Risks / open questions

- **Server-side following makes redirect chains invisible.** A guard that
  bounces through three URLs now shows the client one response, and the
  intermediate hops appear in no network log. The budget error names the
  cycle, but a dev-mode `x-flypath-hops: /me,/login` header may earn its
  place; it is the debugging surface the two-round-trip version gave away
  for free.
- **The hop loop reruns middleware, which reruns side effects.** A
  `request` middleware that counts, logs or opens a transaction fires
  once per hop rather than once per navigation. This is the same bill
  plan 9 already names for "one navigation is several requests", now with
  a second axis. `isPrefetch()` has no analogue here; a `hop()` accessor
  is the obvious escape hatch and is deliberately not in this plan until
  something needs it.
- **`relocate` races a fast user.** Between the optimistic push and the
  redirect resolving, the user can press back, switch tabs, or push
  again. Step 1 drops the payload when the key is gone, which is correct
  for back and for tab switches, but a second push onto the same stack
  leaves the stale entry *underneath* the new one — patched in place by
  step 2, which is right, but it means a screen the user has already
  moved past changes its URL and options after the fact. Probably fine,
  possibly surprising in a slide-back gesture.
- **The seed-then-navigate ordering is fragile.** On web the seed must
  land after `invalidatePayloads()`; on native the seeded map must be
  read exactly once and dropped, or a later navigation to the same URL
  serves a stale guard result. One-shot entries make it safe; a plain
  cache would not.
- **Refresh over a guarded stack fans out.** `refresh`
  (`native-router.ts:252`) refetches every screen entry by its recorded
  URL, so a sign-out that invalidates three guarded screens produces
  three redirects, three relocations, and three payloads. It falls out
  correctly from step 2 — every one patches in place — but it is the
  first time several entries change identity in one commit, and it is the
  test worth writing.
- **Cross-origin `navigate` is unhandled today and stays unhandled.**
  `isExternal` guards the client side (`native-root.tsx`), but a
  middleware calling `navigate("https://…")` currently produces a command
  the internal follower would try to dispatch. Phase 4 catches it and
  falls back to the 204; Inertia's `409` + `X-Inertia-Location` is the
  shape to copy if it needs more.
- **`x-flypath-location` is a header, so it cannot stream.** It is
  emitted before the body, which is fine while `toFlight` collects the
  whole payload into bytes first (`server-entry.tsx`). When flypath
  streams, the location must still be known at header time — it is,
  since the hop loop resolves before rendering starts — but a redirect
  thrown *mid-render* would already have flushed headers. That is the
  same caveat plan 9 names for the after-phase, and it argues for
  keeping render-time `navigate()` rare.
