# Flypath — client components plan

## Goal

`"use client"` components authored in app code work on web and native:

```tsx
// app/counter.tsx
"use client";

import { useState } from "react";
import { colors, spin } from "./vars.css.ts";

export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <button
      onClick={() => setN(n + 1)}
      style={{
        color: { default: colors.primary, ":active": colors.secondary },
        animation: n > 9 ? `${spin} 1s linear` : undefined,
      }}
    >
      count: {n}
    </button>
  );
}
```

The component hydrates and runs on the browser, and runs on iOS/Android
inside the RN renderer — same source, no platform forks — with the full
styles system (tokens, conditions, themes, animations from PLAN_STYLES.md)
and DOM event props working on both.

## The SDUI guarantee, restated

Today the guarantee is enforced as "the native bundle's client-reference
registry is closed; only framework primitives exist on the device." That
formulation cannot admit app client components, so the guarantee becomes
what it was always really about:

**The app binary ships zero app code. Every piece of executable app code
arrives from the flypath server, and only from it, versioned atomically with
the payload that references it.**

This is exactly how RSC already works on web — client references resolve to
code-split chunks fetched on demand — and the native side adopts the same
model: the server compiles Hermes-compatible chunks for client modules and
the device fetches them when the flight payload references them. The server
still owns all UI and all code; the device remains a dumb, always-in-sync
execution shell. Enforcement moves from "registry is closed" to "the chunk
loader only loads from the configured server origin" (plus the primitives
registry as the built-in fast path).

## Current state

- **Web**: plugin-rsc wires client references, chunking, and hydration; none
  of it has been exercised (the example is server-only). The client jsx
  runtime is a bare re-export of React's, so flypath style features don't
  work in client components.
- **Native**: `client-references.ts` throws for anything outside the
  primitives registry; the native environments produce a single dev bundle
  from `native-entry`; there is no chunk story, no device-side intrinsic
  mapping, and no device-side style normalization.

## Web track

1. **Example**: add `app/counter.tsx` as above, rendered from the index
   route. This is the testbed for everything below.
2. **Hydration + references**: verify plugin-rsc discovers `"use client"`
   modules under `example/app/**`, emits browser chunks, and hydrates; fix
   whatever the untested path exposes.
3. **Client jsx runtime**: replace the re-export with an intrinsic wrapper
   sharing modules with the server runtime:
   - style array flattening,
   - shorthand expansion + conditional-value atomic class generation, with
     rule delivery via the same React 19 `<style href precedence>` hoisting
     (React handles injection identically for client renders),
   - memoization per style-object identity.
4. **`*.css.ts` in the client environment**: the compiler plugin already
   applies per-environment; verify the client flavor (token strings only,
   no server registry) and that importing the same `vars.css.ts` from server
   and client components yields identical hashes.
5. **react-refresh**: component edits fast-refresh preserving state
   (rolldown-vite's refresh transform through plugin-rsc); `*.css.ts` edits
   hot-swap CSS without losing component state.
6. **Dynamic conditional values**: state-driven values in condition maps
   mint new atomic classes per value; hoisted rules are never removed, so
   high-cardinality dynamic values accumulate. v1: document + dev warning
   past a threshold; later: CSS var indirection for the dynamic case.

## Native track

### Chunk pipeline (server side)

- Extend the native environments (which already emit `__d` factories against
  metro-runtime's require.js for the dev bundle) to build **chunks**: for
  each client module reachable from app code, chunk = the module plus its
  transitive deps **minus** everything in the base bundle (react,
  react-native, framework runtime, primitives, polyfills). Chunks go through
  the same bundler layer as the base bundle — lazified requires and
  namespace proxies included — so RN's lazy-require idioms keep working in
  chunk code.
- Stable, deterministically path-derived module IDs (in the form
  metro-runtime's require.js accepts) shared between base bundle and chunks,
  so chunk factories require shared deps out of the live metro-runtime
  registry — one React, one react-native, no duplication.
- Dev: `/chunk.bundle?platform=ios&id=<moduleId>` served on demand through
  the same incremental transform cache as the dev bundle; prod: chunks
  emitted as content-hashed files per platform at build time.
- Chunks are compiled with `jsxImportSource: "flypath"` resolving to a new
  **native client jsx runtime** (below), and with the react-refresh
  transform in dev.
- Source maps per chunk; `/symbolicate` resolves chunk URLs so LogBox stack
  traces from app client code symbolicate like base-bundle frames.

### Manifest + loader (device side)

- A per-platform native manifest (dev: computed on demand; prod: baked at
  build) maps client-reference IDs → chunk URL + export name. The flight
  payload's reference IDs stay as they are; resolution happens in the
  loader.
- `installClientReferences` becomes a two-tier loader:
  1. primitives registry (baked in, synchronous),
  2. chunk fetch from the server origin, plugged in as metro-runtime's
     async-loading hook (`__loadBundleAsync` — the contract RN's segment
     loading is written against, keeping HMRClient/LogBox/Fast Refresh
     on-contract): download, evaluate via `globalEvalWithSourceUrl` (correct
     stack traces), let the chunk's `__d` calls land in the shared registry,
     require the entry. Cached by chunk hash; concurrent requests for the
     same chunk dedupe; failures surface through the existing ErrorBoundary
     with the chunk URL in the message.
- The loader refuses any URL not on the server origin the shell was
  configured with (the dev server binds all interfaces, so that origin is
  e.g. `10.0.2.2:8081` on the Android emulator) — this is the enforcement
  point of the restated guarantee.

### Device-side intrinsics + styles

App client components render DOM intrinsics *on the device*, so the mapping
and style work that PLAN_STYLES.md runs in the rsc environment must also run
on-device for chunk-rendered trees:

- **Native client jsx runtime** (`jsx-runtime.native.ts`, shipped in the
  base bundle): maps intrinsic tags to the primitives (same table as the
  server's `resolveIntrinsic`) and runs style normalization — shorthand
  expansion, value parsing, condition descriptors, view/text split — using
  the same shared modules the server uses. The primitives then resolve
  descriptors exactly as they do for server-rendered styles (ThemeContext,
  inherited text styles, condition matching, Animated driver): one
  resolution path regardless of where the element was created.
- **`*.css.ts` native flavor**: token exports carry inline metadata
  (conditional var defaults, keyframe frames) since there is no server
  registry on the device; hashes identical to every other flavor so themes
  and vars interoperate across the server/client boundary.
- **Event props**: primitives map DOM event props to RN equivalents —
  `onClick` → `Pressable.onPress`, `onFocus`/`onBlur`, `onChange` for future
  input primitives — pass-through on web. Handlers only exist inside client
  components, so this lands here rather than in the styles plan.

### Interactive intrinsics (the elements PLAN_STYLES.md could not add)

PLAN_STYLES.md landed every intrinsic whose behaviour is purely presentational
— `div`, `span`, `p`, `h1`–`h6`, `article`, `section`, `aside`, `header`,
`footer`, `main`, `nav`, `figure`, `figcaption`, `blockquote`, `strong`, `b`,
`em`, `i`, `small`, `code`, `pre`, `label`, `button`, `img` — because
`createPrimitive(tag)` only needs a row in `TAG_DEFAULTS` for those.

The rest are blocked on client components, not on styling. They need state
and event handlers, which a server component cannot hold and the flight
payload cannot serialize:

- **`input`, `textarea`** → `TextInput`. Needs `value`/`defaultValue` +
  `onChange`/`onInput`, controlled-vs-uncontrolled semantics matching the DOM,
  and DOM-shaped event objects (`event.target.value`) synthesized from RN's
  `onChangeText`. `type` maps onto `keyboardType`/`secureTextEntry`/
  `autoComplete`; unmappable types (`file`, `color`, `range`, `date`) are
  strict-subset errors.
- **`select`, `option`** → no RN equivalent. Either a `Modal`-based picker
  primitive or a strict-subset error; decide when the form story is designed.
- **`form`** → no native submit model. Meaningful only once `"use server"`
  actions land, which is explicitly out of scope below.
- **`a`** → `Text` with `onPress` calling `Linking.openURL`, once routing
  exists to say what an in-app `href` means.
- **`button` gains its handler here.** The primitive already renders as a
  `Pressable` and tracks `:active`/`:hover`/`:focus`; `onClick` →
  `Pressable.onPress` is the mapping described under **Event props** above.

Two more sit outside both plans because no native equivalent exists at all:
`ul`/`ol`/`li` (no list markers on native — RSD does not support them either;
would need markers synthesized in the primitive) and `table` and friends,
`details`, `dialog`, `canvas`, `svg`.

Adding an interactive tag is the same shape as the presentational ones — one
row in `TAG_DEFAULTS`, one export in `elements.tsx`, one entry in
`nativeIntrinsics` (typed `Record<Tag, unknown>`, so a missing entry is a
compile error) — plus the event-prop and controlled-value mapping in
`createPrimitive`.

### Composition rules (standard RSC, enforced with good errors)

- Props crossing server → client must be flight-serializable; `children`
  works (server-rendered subtrees pass through client components).
- App code never imports `react-native` directly — it won't resolve on web
  and would pierce the abstraction; the strict intrinsic + hook surface is
  the API. Build-time error naming the importer.
- `"use server"` actions, forms, and cross-platform hooks
  (useWindowDimensions-alike) are out of scope here.

### HMR

- v1: editing a client component invalidates its chunk → push over the
  existing `/flypath` socket → device refetches payload + cache-busted
  chunks and re-renders (client state lost, but live).
- v2: react-refresh in chunks — re-evaluate the updated chunk into the same
  metro-runtime registry, and the Fast Refresh integration the base bundle
  already has swaps component types in place, state preserved. `*.css.ts` edits ride the
  payload refetch (styles live in payloads/chunks, never require a base
  bundle rebuild).

### Production

- `flypath build` emits per-platform chunk files + manifest alongside the
  web build; chunk URLs content-hashed and served immutable, so payload ↔
  chunk consistency is guaranteed by construction (both come from the same
  server build).
- Optional optimization: precompile chunks to Hermes bytecode (HBC) at build
  time and serve HBC to matching Hermes versions (plain source as
  fallback) — eval of source text works but skips bytecode caching.

## Phases

### Phase 1 — web client components

Counter in the example; hydration + reference discovery fixes; client jsx
runtime with the shared style modules; `*.css.ts` client flavor;
react-refresh.
Acceptance: counter hydrates and increments; `:active` styles and the
conditional animation work; editing the component fast-refreshes preserving
state; editing `vars.css.ts` restyles without losing state.

### Phase 2 — native chunks render

Stable module IDs; chunk builder + dev endpoint; manifest; two-tier loader
with origin enforcement; native client jsx runtime + `*.css.ts` native
flavor.
Acceptance: the same counter renders and increments on both simulators;
tokens/conditions/themes resolve identically to server-rendered elements; a
reference the manifest doesn't know is a hard, well-messaged error.

### Phase 3 — events + errors

Event prop mapping in primitives; the interactive intrinsics above (`input`,
`textarea`, `a`, and `button`'s handler); chunk source maps through
`/symbolicate`; loader failure UX through the ErrorBoundary.
Acceptance: `onClick` fires on all three platforms; a controlled `input`
round-trips `value`/`onChange` identically on web and both simulators; a throw
inside the counter shows LogBox with symbolicated chunk frames.

### Phase 4 — native HMR

v1 refetch path, then react-refresh in chunks.
Acceptance: editing the counter updates both simulators; with refresh
enabled, count state survives the edit.

### Phase 5 — production

Chunk emission + manifest in `flypath build`; immutable serving; HBC
precompile decision.
Acceptance: release-mode app on both platforms renders and runs the counter
against a production server; chunk fetch happens once and caches.

## Risks / open questions

- **Hermes eval in release**: evaluating JS text in a release Hermes runtime
  works but forgoes bytecode precompilation; measure chunk eval cost on a
  low-end Android device before deciding whether HBC serving is required
  rather than optional.
- **Module identity**: any accidental duplication of react/react-native
  between base bundle and chunks breaks hooks and context silently; needs a
  hard build-time check (chunk must not contain modules the base provides).
- **react-refresh across fetched chunks**: chunks define modules through the
  same metro-runtime registry Fast Refresh is written against, which keeps
  the integration on-contract, but refresh boundaries in eval-delivered code
  are still less traveled; v1's refetch fallback exists so this never blocks
  shipping.
- **App store policy**: executing server-delivered JS in Hermes is the same
  territory as Expo Updates/CodePush — accepted in practice when it doesn't
  change the app's purpose, but it is Apple-guideline gray area (3.3.2) and
  worth an explicit stance in docs.
- **Version skew**: a device holding a long-lived session across a server
  deploy can reference chunks the new server no longer serves; content
  hashing makes stale fetches fail loudly — need a payload-level
  build-version marker that triggers a clean reload instead.
- **plugin-rsc coupling**: reusing its reference-ID scheme for a second,
  non-browser consumer deepens the dependency on its internals (already
  flagged in PLAN.md); pin and read source.
- **Payload + chunk waterfall**: first render of a payload referencing many
  client components serializes fetches; manifest allows preloading all
  referenced chunks in parallel as soon as the payload header arrives —
  design the flight client hook for it early.
