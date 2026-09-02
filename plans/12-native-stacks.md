# Flypath — native stacks

## Goal

Give a native stack the motion and the gestures of the platform it runs on —
UIKit's interactive edge-swipe on iOS, Android's predictive back — while the
framework keeps drawing exactly zero pixels of navigator UI. Every header,
every tab bar, every back affordance stays a server component in app code, as
it is today. The platform owns _how a screen arrives and leaves_; the app owns
_everything on it_.

Alongside that, stop paying for the screens nobody is looking at: a payload
landing on one screen currently re-renders every mounted screen in the app,
backgrounded trees keep rendering, and screens covered by an opaque overlay
stay readable by VoiceOver.

Milestone: on iOS, dragging from the left edge of `/p/1` slides the post off
with the feed parallaxing behind it, cancels below threshold, and pops past
it — and the only chrome on screen throughout is `example/app/tab-bar.tsx`'s
own `<nav>`, with no `UINavigationBar` and no `UITabBar` anywhere in the view
hierarchy. On Android, dragging from the edge scales `/p/1` down and away,
revealing the feed underneath, and cancelling restores it. On both, a
`revalidate` that lands a new payload on `/me` re-renders one `Screen`.

## What is broken today

**Stacks are opaque overlays; branches are `display: none`.** `StackHost`
(`components/native/navigator.tsx:158`) renders every entry at once — depth 0
gets `styles.base` (`flex: 1`), everything above gets `styles.overlay`
(`:243`), which is `position: absolute`, inset 0, `backgroundColor: "white"`.
Screens below the top are fully laid out and drawn, just covered.
`BranchesHost` (`:204`) is the only place `display: none` appears (`:240`).

**The transitions are JS-driven.** `Screen` (`:92`) starts an
`Animated.timing` on mount and another on `exiting`, with `useNativeDriver:
true` — so the frames are off-thread, but the start, the stop, the mount, and
the exit bookkeeping (`exiting` state, `previous` ref, `onExited`, `:163`–
`:178`) all live in JS. Nothing about that can be driven by a finger.

**iOS has no back gesture, and cannot have one.** "Slide to go back on iOS" has
been on `TODO` since plan 6, which parked it as a phase 7 spike and wrote down
why: "JS-driven `Animated` transitions in v1; react-native-screens fidelity
(native gestures, freeze) is a later evaluation"
(`plans/6-navigation.md:358`). RN core ships no gesture responder that can
drive a cancellable, velocity-tracked, interruptible transition that also
cooperates with the scroll views inside a screen. The JS answer is
gesture-handler plus reanimated — two more native dependencies to buy one
gesture UIKit already has.

**Android back is the pre-predictive API.** `native-root.tsx:267` registers
`BackHandler.addEventListener("hardwareBackPress", back)`. That is a boolean:
back happened, did you handle it. There is no progress, so there is no
animation to attach to the finger, and nothing can be cancelled halfway.

**Modal presentation is a hardcoded 600px.** `presentation: "modal"` resolves
to a `translateY` with `outputRange: [0, 600]` (`navigator.tsx:114`–`:124`).
No sheet, no drag-to-dismiss, no presenter card scaling, and wrong on any
device that isn't ~600pt tall.

**One payload re-renders every screen.** `native-root.tsx:315` memoizes
`{ ...router, content }` into a single context value. `Screen` (`:93`),
`StackHost` (`:159`), `BranchesHost` (`:205`) and `Container` (`:66`) all call
`useNavigator()`. So any screen's payload arriving invalidates every consumer
in the app. The RSC `node` references are stable, so the children bail out
cheaply — but the wrapper work is O(mounted screens) per payload, and it grows
with every tab the user has visited.

**Backgrounded trees keep rendering.** Nothing freezes. A hidden branch's
client components re-render on every context change, forever.

**Covered screens are still in the accessibility tree.** There is no
`accessibilityElementsHidden` or `importantForAccessibility` anywhere in
`src/` — one `accessibilityRole` at `components/native/primitive.tsx:461` is
the whole of it. Occlusion by an opaque sibling means nothing to VoiceOver or
TalkBack: both walk straight into the screens underneath. `A11Y` is on `TODO`;
this is the concrete instance of it.

## Field notes — prior art

**react-native-screens** is the reference implementation and the thing we are
deliberately not depending on. Its shape is worth copying:

- `RNSScreenStackView` hosts a `UINavigationController`; `RNSScreenView` is an
  `RCTViewComponentView` whose `UIViewController`'s `view` _is itself_. The
  stack overrides Fabric's `mountChildComponentView:index:` to register
  children rather than add them as subviews, and hands the controllers to the
  nav controller.
- JS stays the source of truth. Native dismissals are reported after the fact
  (`onDismissed`), and the native side tracks which children it has already
  removed so the follow-up props update does not animate a second time. The
  `activityState` tri-state (inactive / transitioning / active) exists because
  `display: none` is the wrong tool for a view controller.
- `freezeOnBlur` uses `react-freeze`: a component that throws a
  never-resolving promise when frozen, so React switches the Suspense boundary
  to its fallback and _hides_ the mounted children — state preserved, renders
  stopped.
- Headers are opt-in. `headerShown: false` is a supported, first-class mode,
  which is the mode we will live in permanently.

**UIKit**: with `navigationBarHidden = YES`, UIKit disables
`interactivePopGestureRecognizer`. The documented recovery is to take its
`delegate` and answer `gestureRecognizerShouldBegin` yourself. This is the one
non-obvious line in the whole iOS implementation.

**Material's predictive back** specifies the in-app back animation:
the top surface scales down (to ~0.9), translates horizontally away from the
touched edge, gains corner radius, and the surface underneath is revealed.
`androidx.activity`'s `OnBackPressedCallback` supplies
`handleOnBackStarted` / `handleOnBackProgressed(BackEventCompat)` /
`handleOnBackCancelled` / `handleOnBackPressed`; the animation itself is ours
to draw, which is exactly what we want.

## Options considered

**Depend on react-native-screens.** By far the cheapest in hours, and
rejected. It would be the first large third-party native dependency in a
framework whose entire native surface is 40 files we control, and it does not
autolink into our hosting: components arrive through `FlypathFabricComponents()`
(`native/generate-cpp.ts:88`, merged in `apple/core/FlypathAppDelegate.mm:22`)
and `FlypathPackage(listOf(...))` (`templates/.../MainApplication.kt:21`), both
of which we generate. We would be threading someone else's Podspec and Gradle
module through our Package.swift and our template by hand, and inheriting a
header/tab-bar surface we will never use. The parts of it we actually want —
a container that holds children as view controllers, a gesture, an animation,
and a dismissal callback — are the small part.

**Extend the `"use native"` component pipeline to take children, then build
the stack as consumer-style codegen.** Rejected for now.
`native/manifest.ts:309` and `:351` throw `"children" is not supported on a
native component yet`, and lifting that is a real project: on iOS it means
teaching `FlypathComponentView` to route Fabric children somewhere other than
`contentView`, and on Android `FlypathComposeView` is an `AbstractComposeView`
(`android/dev/flypath/FlypathViewManager.kt:33`) whose content comes from
`Content()` — RN child views do not arrive that way at all. Navigation should
not be blocked behind that, and navigation is not a good first customer for
it either.

**Framework-owned Fabric components, hand-written, registered next to the
generated ones.** Chosen. This is the same shape as `FlypathInsets` — a piece
of native the framework owns outright because a route option depends on it,
sitting beside the codegen rather than inside it. Two components, two
platforms, no new dependency, and the consumer pipeline keeps throwing on
children until someone has a reason to change that.

**Move branches (tabs) native too, via `UITabBarController`.** Rejected, and
this is the load-bearing rejection. A tab bar controller _is_ generic UI; the
whole point of `plans/6-navigation.md`'s "the framework owns navigation
behavior, never navigator UI. There is no `TabBar` primitive" is that
`example/app/tab-bar.tsx` draws the tabs. Branches have no gesture and no
platform transition to inherit — switching tabs is a cut on both platforms —
so there is nothing to buy. Branches stay JS and get the freeze and
accessibility fixes instead.

## The line: platform motion, app chrome

The guarantee this plan makes, stated so it can be checked:

- The native stack renders no UI of its own. On iOS `navigationBarHidden` is
  set at construction and never unset; there is no toolbar, no title, no back
  button, no `UITabBarController`. On Android `FlypathScreenStackView` is a
  `ViewGroup` that draws nothing but its children.
- Every pixel still comes from server components. Chrome fragments
  (`navigator.tsx:65`, keyed by `chromeKey`) render exactly as they do today,
  and `useBranches()` (`router/scope.tsx:107`) keeps feeding the app's own tab
  bar.
- What the platform gains is _motion and gesture_: the push slide with the
  parallax and dimming of the screen underneath, the edge-swipe with UIKit's
  physics, the back-progress animation that follows an Android finger. That
  is muscle memory, not chrome. A user's hands know the edge swipe; nobody's
  hands know our nav bar, because we do not have one.
- And it is opt-out per route. `transition: "none"` turns the native
  animation off entirely, leaving a screen that appears and disappears with no
  motion at all — at which point a consumer can animate their own content
  however they like inside it. `gesture: false` refuses the interactive pop on
  a screen that needs the edge for something else, or that should not be
  dismissed by accident.

## The model

Two framework-owned host components, one JS state model unchanged.

```
<ScreenStackView active onPopped>          ← UINavigationController / ViewGroup
  <ScreenView screenKey="entry-1" …>       ← UIViewController / child view
    ScreenBoundary → Suspense → Payload    ← unchanged
  </ScreenView>
  <ScreenView screenKey="entry-2" …>
    …
  </ScreenView>
</ScreenStackView>
```

The JS bindings are `ScreenStackView` and `ScreenView`; the strings they
register under are `"FlypathScreenStack"` and `"FlypathScreen"`. The prefix
belongs to the namespaces that have no scoping of their own — the flat Fabric
component registry shared with every RN library in the app, and ObjC's class
table — not to a TypeScript module. Consumer components take
`Flypath_<slug>_<name>` (`native/manifest.ts:135`); framework-owned ones take
`Flypath<Name>`, so the two schemes cannot collide and a name says which it
is.

`StackHost` stops being an animation engine and becomes a projection of
`tree[id].entries` onto that child list. Everything inside a screen — the
error boundary, the Suspense fallback, the safe-area padding, the payload —
is untouched, so `native-content.ts` does not change at all.

### Props

`ScreenStackView` — registered as `"FlypathScreenStack"`:

| prop       | type                       | meaning                                  |
| ---------- | -------------------------- | ---------------------------------------- |
| `active`   | `boolean`                  | this stack is on screen (see branches)   |
| `onPopped` | `(keys: string[]) => void` | native already dismissed these, catch up |

`ScreenView` — registered as `"FlypathScreen"`:

| prop           | type                             | meaning                                   |
| -------------- | -------------------------------- | ----------------------------------------- |
| `screenKey`    | `string`                         | `Entry.key`, the identity native diffs on |
| `presentation` | `"push" \| "modal"`              | from the route option                     |
| `transition`   | `"platform" \| "fade" \| "none"` | from the route option                     |
| `gesture`      | `boolean`                        | interactive dismissal allowed             |

`ScreenEntry` (`components/native/navigator-context.ts:7`) grows `transition`
and `gesture`, filled by `screenAt` (`runtime/native-router.ts:34`) off the
manifest match, exactly like `safeArea` and `presentation` already are.
`RouteOptions` (`router/types.ts:12`) grows the two matching options.

### The reconciliation contract

This is the part that bites, so it is a contract rather than an
implementation detail.

1. **JS is the source of truth. Native never mutates the tree.** Every
   structural change still goes through `navigate` / `goBack` / `relocate` in
   `runtime/native-router.ts`.

2. **Native reports completed dismissals, it does not request them.** When a
   gesture or a system back completes, the native side finishes the animation
   itself, keeps the dismissed screen alive but detached, and emits
   `onPopped({ keys })`. JS then removes those entries. A new
   `popKeys(router, keys)` in `native-router.ts` does this by reusing
   `withoutEntry` (`:314`) — which already handles the "stack is now empty,
   fall back to the parent's first branch" case.

3. **Native tracks what it has already dismissed.** A `dismissed` set holds
   keys popped natively and not yet gone from props. When the props update
   removes them, the removal is applied without animating — it already
   happened. If a props update arrives that still contains a dismissed key
   (JS declined the pop — a guard, a redirect landing back on the same
   entry), the screen is re-attached without animation and the key leaves the
   set.

4. **Props updates diff into (common prefix, removed tail, added tail).**
   Animate only when exactly one screen was added and none removed, or one
   removed and none added. Everything else — a replace, a deep-link reset, a
   `relocate` that moves an entry between containers — applies
   non-animated. This is deliberately conservative; a multi-screen animated
   transition is not worth the state machine.

5. **A props update that lands during an interactive transition is queued**
   and applied when the transition ends. This is the reason the whole thing
   works: Yoga writes a screen's frame only on a layout commit, and a UIKit
   transition is not a commit, so RN and UIKit never fight over the frame —
   unless a re-render commits mid-gesture. On iOS the screen view also
   overrides `updateLayoutMetrics:` to drop frame writes while its stack is
   transitioning, as a belt-and-braces second line.

6. **`onPopped` is idempotent and late-safe.** A key that is no longer in the
   tree is ignored.

### What survives a back

The contract a stack owes its user: going back lands you on the screen you
left, in the state you left it. Scroll offset, text you had typed, an open
accordion, a playing video's position.

That works because those screens are never unmounted. `StackHost` renders
every entry in `tree[id].entries`, and it keeps doing so — depth is a native
`ScreenView` child rather than an overlay, but the React subtree and the
host views underneath it are continuous from push to pop. Client state lives
where it always did.

The screens that _do_ get torn down are the ones the user dismissed. `goBack`
slices the tail off `entries` (`native-router.ts:267`), the child unmounts,
and `sync` prunes its payload through `liveKeys` (`:187`). Pushing the same
URL again mints a fresh key from `nextKey()` (`:29`), so React mounts a new
subtree with new state — which is what both platforms do, and what a user
expects: a screen you closed does not come back half-scrolled.

Freeze does not move this line. A frozen subtree is hidden, not unmounted:
committed children keep their state and their host views. The one thing it
does move is effects — a hidden boundary tears its layout effects down and
re-runs them on thaw, and whether passive effects follow depends on React's
Offscreen semantics in the version we are on. Phase 1 establishes that
empirically before anything else is built on it, because a screen holding a
subscription or a player behaves differently under the two answers. The freeze
rule already keeps the top two screens live, so nothing a back gesture reveals
is ever in that state.

Client state and server content are separate axes. A backgrounded screen
keeping its React state says nothing about whether its payload is refetched on
return; that stays `revalidate` and `staleTime` from plan 11, untouched here.

### Branches, and `active`

`BranchesHost` keeps `display: none` — Yoga skips the subtree in layout, which
is genuinely cheap, and branch switching has no transition to inherit. But a
hidden branch may contain a native stack, and `display: none` says nothing to
a `UIViewController` about appearance callbacks or to a gesture recognizer
about whether it should be listening. So `BranchesHost` provides an
`ActiveContext`, the nested `StackHost` reads it, and it reaches native as
`active`:

- iOS: drives manual appearance transitions on the hosted controllers
  (`beginAppearanceTransition:animated:`) and disables the pop gesture
  recognizer.
- Android: disables the stack's `OnBackPressedCallback`, so back falls through
  to the visible stack rather than popping an invisible one.

## iOS

`apple/core/FlypathScreens.mm`, registered through a new
`FlypathCoreFabricComponents()` merged in `FlypathAppDelegate.mm:19` alongside
the generated `FlypathFabricComponents()`. Hand-written `ViewProps` subclasses
and `ConcreteComponentDescriptor`s — the generated `FlypathProps` bag
(`apple/core/FlypathComponent.h:11`) is for `"use native"` components with
their `folly::dynamic values`; framework components get typed props.

**`FlypathScreenComponentView`** is an `RCTViewComponentView` that owns a
`UIViewController` whose `view` is the component view itself. It never adds
itself to a superview; the nav controller places it.

**`FlypathScreenStackComponentView`** hosts a `UINavigationController`:

- `navigationBarHidden = YES` at construction, never unset.
- `mountChildComponentView:index:` registers the child's controller instead of
  adding a subview; `unmountChildComponentView:` deregisters. Both go through
  the diff in the contract above.
- `viewController.edgesForExtendedLayout = UIRectEdgeAll` and
  `extendedLayoutIncludesOpaqueBars = YES`, so the controller view is
  full-bleed and flypath's own inset padding (`navigator.tsx:139`,
  `insetPadding`) stays the single source of safe-area truth. Nothing about
  today's safe-area behavior changes.

**The gesture.** With the bar hidden UIKit turns
`interactivePopGestureRecognizer` off, so the stack view takes its `delegate`
and answers:

- `gestureRecognizerShouldBegin:` → `YES` when `viewControllers.count > 1`,
  the stack is `active`, no transition is in flight, and the top screen's
  `gesture` prop is true.
- `gestureRecognizer:shouldRecognizeSimultaneouslyWithGestureRecognizer:` →
  `NO`, so it does not fight the scroll views inside a screen.
- `UINavigationControllerDelegate.didShowViewController` re-asserts the
  delegate, which UIKit resets on some transitions.

On completion, the popped key goes into `dismissed` and `onPopped` fires. On
cancellation, nothing is emitted — UIKit already put the screen back.

**`transition`.** `"platform"` is UIKit's default push. `"fade"` and `"none"`
are a `UIViewControllerAnimatedTransitioning` supplied by the stack's
`navigationController:animationControllerForOperation:` — a crossfade and a
zero-duration cut respectively. `"none"` also implies no interactive pop.

**`presentation: "modal"`** is not a push: the screen's controller is
presented on the top controller with `modalPresentationStyle = .pageSheet`,
which brings drag-to-dismiss, the presenter's card scaling, and correct status
bar handling for free. `presentationControllerDidDismiss:` feeds the same
`onPopped` path. Detents and a `sheet` option are explicitly out of scope; the
goal here is parity plus a real sheet, not a presentation API.

## Android

`android/dev/flypath/FlypathScreens.kt` — plain `ViewGroup`s and
`ViewManager`s, not Compose. `FlypathPackage.createViewManagers`
(`FlypathViewManager.kt:83`) prepends the two core managers to the generated
per-name list, so nothing about the `__FLYPATH_VIEW_NAMES__` template
substitution changes.

**`FlypathScreenStackView : ViewGroup`** lays every child out at its own
bounds and manages visibility and z-order itself. Push and pop animations run
on the UI thread with a `ValueAnimator`, keeping the current visual — incoming
fades in and scales 0.96 → 1.0, outgoing fades and scales 1.0 → 1.04, which is
what `navigator.tsx:126`–`:132` draws today, moved off JS.

**Predictive back.** The stack view registers an `OnBackPressedCallback` on
the activity's `OnBackPressedDispatcher` when attached, keyed to the view's
lifecycle owner:

- `enabled = active && childCount > 1`. When it is false the dispatcher falls
  through to the next callback, which is RN's — so the JS `BackHandler` in
  `native-root.tsx:267` still runs for the root-level "pop the branch back to
  the first tab, then exit" fallback. That fallback stays; it just stops being
  the mechanism for popping stacks.
- `handleOnBackStarted(BackEventCompat)` captures the swipe edge and freezes
  the queue.
- `handleOnBackProgressed(BackEventCompat)` drives the Material animation
  directly from `progress` and `touchX/touchY`: the top child scales toward
  0.9, translates away from the touched edge, and takes a corner radius via an
  outline provider; the child underneath is revealed.
- `handleOnBackCancelled()` animates the top child home.
- `handleOnBackPressed()` runs the animation to completion, adds the key to
  `dismissed`, and emits `onPopped`.

Dispatcher order is LIFO among enabled callbacks, and
`ComponentActivity.onBackPressed()` delegates to the dispatcher, so the stack
is consulted before RN's handling regardless of which path RN takes
internally.

`templates/android/app/src/main/AndroidManifest.xml` gains
`android:enableOnBackInvokedCallback="true"` on `<application>`. `targetSdk`
is already 36 (`templates/android/app/build.gradle.kts:20`) so it is on by
default, but stating it means the behavior does not move when the target
does. `minSdk` is 24; below API 33 there is no gesture progress and back is a
plain animated pop, which is correct for those devices.

`androidx.activity` arrives already via `activity-compose:1.10.1` (`:75`),
well past the 1.8.0 that added the progress callbacks.

**`presentation: "modal"`** slides up from the bottom with the same
`ValueAnimator` machinery. Drag-to-dismiss on Android is deferred.

## The JS improvements

These land first, alone, and are worth landing even if the native work never
happens. Two of the three problems in this plan are not native problems.

### Per-key content subscription

`native-content.ts` already holds `content` at module scope and pushes it into
React through a single `bridge.publish` (`:112`). The fan-out is entirely a
consequence of lifting that map into one `useState` at the root
(`native-root.tsx:151`) and handing it out through one context.

Replace it with a per-key subscriber registry in `native-content.ts`:
`subscribe(key, listener)` returning an unsubscribe, and `publish` diffing the
next map against the previous and calling only the listeners whose entry
changed by reference. `Screen` and the chrome branch of `Container` register
their own key. The root stops holding `content` at all, and `NavigatorValue`
loses `content` — the context becomes tree-only.

Not `useSyncExternalStore`: store updates are urgent by construction, and the
current `startTransition(() => setContent(map))` is what keeps a re-fetching
screen from flashing its Suspense fallback. The registry keeps that — the
publisher calls the individual setters inside one `startTransition`.

### Freeze

A dependency-free `<Freeze>`: a child that throws a never-resolving promise
while frozen, inside a Suspense boundary. React swaps to the fallback and
hides the mounted children rather than unmounting them, so state survives and
rendering stops. The never-resolving promise pattern already exists in this
codebase — `ABSENT` (`navigator-context.ts:59`) and `PENDING`
(`native-content.ts:52`).

The freeze rule:

- **Never the top screen, and never the one directly below it.** The screen
  below the top is what an interactive back gesture reveals, and what sits
  behind a modal sheet; it must be live before the finger moves, not after.
  So: freeze entries at index ≤ `length - 3`.
- **Freeze inactive branches** wholesale.

A frozen screen that receives a new payload re-renders when it thaws, which is
the desired behavior and costs nothing — `native-content.ts` holds the content
either way.

### Accessibility

`accessibilityElementsHidden` (iOS) and
`importantForAccessibility="no-hide-descendants"` (Android) on:

- every stack entry that is not the top one, and
- every inactive branch.

On iOS this becomes partly redundant once screens are real view controllers,
but it stays: it is what makes the branches correct, and it is what makes the
`transition: "none"` and pre-native paths correct.

## What changes

**Deleted.** `navigator.tsx` loses the whole animation engine: the `Animated`
imports, the `progress` value and both `useEffect`s (`:95`–`:112`), the
`slide`/`transform` computation (`:114`–`:132`), the `exiting` state, the
`previous` ref and the `rendered` array (`:163`–`:178`), and `styles.base` /
`styles.overlay`. `Screen`'s props collapse from four to one. This plan
removes more JS than it adds.

**`components/native/navigator.tsx`** — `StackHost` projects entries onto
`ScreenStackView` children; `Screen` becomes a `ScreenView` wrapper
around the existing boundary/Suspense/Payload/inset stack; `BranchesHost`
gains `ActiveContext` and the a11y props; both gain `Freeze`.

**`components/native/screens.ts`** (new) — the two host-component bindings,
via `NativeComponentRegistry.get` with a static view config, the same call
`nativeComponent` already makes (`component.tsx:84`). It skips the
`nativeRegistry().components` membership check (`:78`), which exists to catch
consumer-manifest skew; these are always in the binary.

**`components/native/navigator-context.ts`** — `ScreenEntry` gains
`transition` and `gesture`; `NavigatorValue` loses `content`.

**`runtime/native-router.ts`** — `screenAt` reads the two new options;
`popKeys` is added over the existing `withoutEntry`.

**`runtime/native-content.ts`** — the subscriber registry and the diffing
`publish`. `apply`, `sync`, `land`, seeds, epochs and pruning are untouched.

**`runtime/native-root.tsx`** — drops the `content` state and the
`setContent` publish; keeps `BackHandler` as the root-level fallback.

**`router/types.ts`** — `RouteOptions` gains `transition` and `gesture`.
Manifest emission follows automatically; no extractor change.

**Native**: `apple/core/FlypathScreens.{h,mm}`, a
`FlypathCoreFabricComponents()` merged in `FlypathAppDelegate.mm`,
`android/dev/flypath/FlypathScreens.kt`, two managers prepended in
`FlypathPackage`, one manifest attribute.

**Untouched**: web, in full. `router-web.tsx` has browser history and knows
nothing about any of this. Also untouched: the flight protocol, headers,
middleware, revalidation, seeds, params, and the `"use native"` pipeline.

## Phases

### Phase 1 — the JS improvements

Per-key content subscription, `Freeze`, accessibility props. No native code.
Verifiable on its own: a payload landing on one screen re-renders one
`Screen`; a backgrounded tab stops re-rendering; VoiceOver on a pushed screen
cannot reach the screen underneath.

### Phase 2 — the substrate

`ScreenStackView` / `ScreenView` on both platforms with no animation and
no gesture: mount children, diff by `screenKey`, lay out, report nothing.
`StackHost` rewritten onto them. The example app must look and behave exactly
as it does today, minus the transitions. This phase is where the Fabric child
mounting and the frame-ownership question get settled, and it is the phase to
timebox.

### Phase 3 — iOS

`UINavigationController`, hidden bar, push transition, the
`interactivePopGestureRecognizer` delegate, `onPopped`, the queued-update rule,
`active`. Milestone's first half.

### Phase 4 — Android

`ValueAnimator` push/pop, `OnBackPressedCallback` with progress, the manifest
attribute, `active` gating, the `BackHandler` handoff. Milestone's second half.

### Phase 5 — presentation and options

Native modal on both platforms, `transition` and `gesture` route options end
to end, `/compose` in the example app becomes a real iOS sheet.

### Phase 6 — polish

Fast Refresh behavior with live controllers, deep-link resets landing
non-animated, `TODO`'s "Slide to go back on iOS" and "Modal" struck.

## Key decisions

- **Framework-owned Fabric components, not react-native-screens, and not the
  `"use native"` pipeline.** Same standing as `FlypathInsets`: native the
  framework owns because a route option depends on it.
- **The platform owns motion and gesture; the app owns every pixel.** No nav
  bar, no tab bar, no back button, no title, ever — `navigationBarHidden` is
  set once and never read again.
- **Branches stay JS.** They have no gesture and no platform transition to
  inherit, and `UITabBarController` is precisely the generic UI this framework
  refuses to own.
- **JS remains the single source of truth.** Native reports completed
  dismissals; it never asks permission and never edits the tree.
- **Animate only single-screen diffs.** Everything else applies instantly. A
  multi-screen animated transition is not worth the state machine.
- **`transition: "none"` is the customization escape hatch, not a second
  animation engine.** Keeping the JS `Animated` path alive as a per-stack
  fallback would mean maintaining two implementations of everything forever;
  turning the native animation off and letting a consumer animate their own
  content inside a still screen covers the same ground for the cases that
  actually come up.
- **Options are per route, not per stack.** `safeArea` and `presentation`
  already live on `RouteOptions`; `transition` and `gesture` join them there.
  Stack-level defaults would mean threading options through `flatten.ts` and
  can wait for a second customer.
- **Freeze never touches the top two screens.** The one below the top is what
  a back gesture reveals and what sits behind a sheet.
- **Safe areas do not move.** flypath's own inset padding stays the single
  source; the controllers are configured full-bleed so UIKit contributes
  nothing.
- **Modal gets real sheet presentation on iOS in this plan**, because
  replacing the JS overlay without it would be a regression, and because
  `presentViewController:` is most of the work already done.

## Risks / open questions

- **Fabric child mounting is the spike.** Everything else here is
  conventional; hosting RN children as view controllers without letting Yoga
  and UIKit both write frames is the part that decides the schedule. Phase 2
  exists to find that out before phases 3 and 4 are committed to. The
  reasoning that it works — Yoga writes only on commit, a transition is not a
  commit — is sound but needs to survive contact with a real gesture and a
  `revalidate` firing mid-swipe.
- **What freeze does to effects is unverified.** State and host views survive
  a hidden Suspense boundary; layout effects do not, and whether passive
  effects are torn down with them depends on React's Offscreen semantics in
  the version we run. A screen holding a subscription, a socket, or a player
  behaves differently under the two answers, so phase 1 settles it by
  experiment before the freeze rule is finalized — and if passive effects do
  get torn down, the rule may need an opt-out per route rather than a depth
  cutoff.
- **Fast Refresh with live view controllers.** A hot update that re-mounts the
  stack while a controller is presented is a known rough edge in
  react-native-screens and will be one here. Worst case is a dev-only reset on
  `rsc-update`; `native-root.tsx:308` already has the hook to do it.
- **The queued-update rule can starve.** If a transition never ends — a
  gesture the user holds indefinitely — a pending props update waits. Bounded
  in practice by UIKit ending the interaction, but it needs a timeout or an
  explicit cancel path if it shows up.
- **`onPopped` racing a server redirect.** `relocate` (`native-router.ts:350`)
  can move or replace the very entry native just dismissed. Contract rule 3
  covers the "JS declined" direction by re-attaching, but the combination of a
  native pop and an in-flight redirect landing on the same key needs a test,
  not just a rule.
- **Android's predictive back only animates on API 33+.** Below that
  `handleOnBackPressed` fires with no progress and the pop is a plain
  animation. `minSdk` is 24, so a meaningful slice of the floor sees the
  simpler behavior. That is acceptable and matches what every other Android
  app does.
- **`display: none` on a branch containing a presented modal.** An iOS sheet
  is presented on the window, not inside the branch subtree, so hiding the
  branch does not hide the sheet. The `active` prop must dismiss or the
  branch switch must be refused while a modal is up; today's structure makes
  this unreachable (a modal lives in the outer stack, above branches) but the
  route tree does not forbid it.
- **Two animation vocabularies.** iOS gets UIKit's push; Android gets a
  hand-drawn fade-and-scale. They will drift as Material's spec moves. That is
  the correct kind of drift — each platform looking like itself — but it means
  the Android animation is code we own and must keep current.
