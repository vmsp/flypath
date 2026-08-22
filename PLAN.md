# Flypath — SDUI framework plan

## Goal

One codebase of React Server Components (`example/app/index.tsx`) rendered on
web (React DOM), iOS and Android (React Native), with Vite as the only build
tool. The server owns the UI (SDUI): client bundles ship only bootstrapping, a
flight-payload decoder, and a small set of primitive components. Milestone:
`<h1>Hello World!</h1>` renders on all three platforms, with HMR and the full
RN debug stack (Dev Menu, LogBox, React Native DevTools) working in dev.

## Architecture overview

```
                ┌────────────────────────────────────────────┐
                │ Vite dev server (single port, 8081)        │
                │                                            │
                │  RSC env ──► flight payload (per platform) │
                │  SSR env ──► web HTML                      │
                │  client env ──► web browser bundle         │
                │  native env ──► Hermes CJS bundle          │
                │                                            │
                │  Metro-compatible endpoints:               │
                │   /status, /index.bundle, /symbolicate     │
                │   /hot (HMR WS), /message (dev menu WS)    │
                │   @react-native/dev-middleware (inspector) │
                └────────────────────────────────────────────┘
                     ▲                ▲                ▲
                 web browser      iOS shell       Android shell
                 (hydrates)     (RCTAppDelegate  (ReactActivity
                                 subclass)        subclass)
```

- **RSC everywhere.** `@vitejs/plugin-rsc` provides the `rsc`/`ssr`/`client`
  environments for web. We add a fourth custom environment (`native`, split
  per platform) via the Vite Environment API that consumes the same client
  module graph but emits Hermes-compatible output.
- **The native app is a thin flight client.** It boots RN, fetches the flight
  payload from the server route (same route the web uses), decodes it with the
  react-server-dom client runtime, and renders with the RN renderer. App logic
  never ships to the device.
- **Platform-aware intrinsics.** Server components use DOM tags (`<h1>`). A
  custom `jsxImportSource` (`flypath`) intercepts intrinsic elements at render
  time: for web requests they pass through as-is; for native requests they
  resolve to client references of Flypath primitive components that live in
  the native bundle (for now: `h1` → styled `Text`). The platform comes from
  the request (query/header) via AsyncLocalStorage. So the flight payload is
  platform-correct and the client stays dumb — pure SDUI.

## Framework package layout (all new files live here, not in example)

```
src/
  cli.ts                 cac CLI: web | ios | android | build
  vite/
    index.ts             flypath() plugin preset (wraps @vitejs/plugin-rsc)
    native-env.ts        native environment: resolve, transform, bundle
    flow.ts              Babel Flow-strip for react-native internals (cached)
    metro-endpoints.ts   /status, /index.bundle, /symbolicate, /hot, /message
    dev-middleware.ts    mounts @react-native/dev-middleware
  runtime/
    jsx-runtime.ts       custom jsx runtime, intrinsic mapping (server side)
    platform.ts          AsyncLocalStorage request platform context
    server-entry.tsx     RSC entry: routes → app components → flight/html
    web-entry.tsx        browser bootstrap + hydration
    native-entry.ts      RN bootstrap: AppRegistry, flight fetch, render
    modules.ts           Hermes module runtime (__d/__r registry, HMR apply)
    flight-native.ts     flight client wiring + stream polyfills for Hermes
  components/
    native/h1.tsx        Text-based heading primitive ("use client")
  templates/
    ios/                 Xcode project template (RCTAppDelegate subclass)
    android/             Gradle project template (ReactActivity subclass)
```

`example` only gains a `vite.config.ts` calling the `flypath()` preset.
Generated native projects go to `example/node_modules/.flypath/{ios,android}`
(build artifacts materialized from `templates/`, implicitly ignored by living
under `node_modules`).

## Phases

### Phase 1 — CLI + web RSC

1. Implement `cli.ts` with cac: `flypath web` starts the Vite dev server;
   `flypath ios` / `flypath android` prepare, build and launch the native
   shells (later phases); `flypath build` for production output.
2. `flypath()` Vite preset: configures `@vitejs/plugin-rsc` with
   framework-owned entries (`server-entry.tsx`, ssr entry, `web-entry.tsx`),
   `jsxImportSource: "flypath"` for the rsc environment, and a convention
   route: `app/index.tsx` → `/`.
3. Custom jsx runtime: pass-through on web for now (mapping lands in Phase 7).
4. Acceptance: `pnpm web` in example serves Hello World with SSR + hydration;
   editing `index.tsx` hot-updates the browser.

### Phase 2 — Native dev server groundwork

RN's entire debug stack talks Metro's HTTP/WS protocol, so we speak it from
Vite instead of running Metro:

1. Serve on port 8081 (RN's default packager port) so the shells and tooling
   need no configuration.
2. `/status` → `packager-status:running`.
3. `/index.bundle?platform=ios|android&dev=true` → the dev bundle (Phase 3).
4. `/symbolicate` → map Hermes stack frames back through source maps (LogBox
   depends on this).
5. `/hot` WebSocket implementing Metro's HMR protocol (`register-entrypoints`,
   `update`, `update-start/done`, `error`) — RN's built-in HMRClient connects
   here.
6. `/message` WebSocket (dev menu remote commands: reload, open dev menu).
7. Mount `@react-native/dev-middleware` in `configureServer` — this provides
   the CDP inspector proxy (`/inspector/*`, `/json`, `/open-debugger`) that
   React Native DevTools requires, without the community CLI.

### Phase 3 — Hermes bundle pipeline

Hermes has no ES module loader, so Vite's ESM dev transport can't reach the
device directly. We bridge it:

1. **Module runtime** (`modules.ts`): tiny `__d`/`__r` define/require registry
   evaluated first, plus RN's expected globals (`global`, `__DEV__`,
   `process.env.NODE_ENV`, `globalEvalWithSourceUrl` hookup for stack traces).
2. **Native environment**: custom Vite environment per platform with
   - resolution for `.ios.tsx/.android.tsx/.native.tsx` + `react-native`
     conditions,
   - `react-dom` aliased out; `react-native` resolved to source,
   - Flow stripping for `react-native/**/*.js` via Babel with
     `babel-plugin-syntax-hermes-parser` + `@babel/preset-flow`, persistently
     cached keyed by RN version (this is the only Babel in the system),
   - everything else transformed by OXC (`oxc-transform`): TS/JSX, and
     ESM→CJS wrapping into `__d` factories.
3. **Dev bundle endpoint**: walk the module graph from `native-entry.ts`
   through the native environment's `transformRequest`, wrap each module,
   concatenate with the runtime prelude into one script + source map. Cache
   per-module transforms so rebundles are incremental.
4. Entry registers the root component with `AppRegistry` (name fixed:
   `"main"`), initially rendering a static `<Text>` sanity screen before RSC
   lands.
5. Acceptance: bundle evaluates cleanly in a Hermes standalone check
   (`hermes -exec` smoke test) before ever touching a device.

### Phase 4 — Native shells + debug tools (priority)

1. iOS template: minimal Xcode project, `AppDelegate` subclassing
   `RCTAppDelegate`, `bundleURL` pointed at
   `http://localhost:8081/index.bundle?platform=ios&dev=true`. Dependencies
   resolved via Swift Package Manager against RN 0.87's React SPM package —
   no CocoaPods anywhere, no Podfile in the template. New Architecture on
   (RN default).
2. Android template: minimal Gradle project, `MainActivity`/`MainApplication`
   via `ReactActivity`/`ReactNativeHost` (or `DefaultReactHost`), debug
   builds pointed at the packager; run `adb reverse tcp:8081 tcp:8081`.
3. `flypath ios`: materialize template → `xcodebuild` (SPM resolution
   happens inside the build) → `xcrun simctl install` + `launch`, then
   stream logs. `flypath android`:
   materialize → `./gradlew installDebug` → `adb shell am start`. No
   community CLI anywhere.
4. Acceptance checklist (do this before anything else works):
   - App boots showing the Phase 3 sanity screen on both simulators.
   - Cmd+D / Cmd+M opens the Dev Menu.
   - A thrown error shows LogBox with symbolicated frames (via
     `/symbolicate`).
   - "Open DevTools" (dev menu or `/open-debugger`) attaches React Native
     DevTools with console + sources working.

### Phase 5 — Native HMR

1. On file change, recompute affected modules in the native environment, push
   a Metro-protocol `update` message over `/hot` with the re-wrapped factories
   and inverse dependency info.
2. Device side: `modules.ts` re-evaluates factories via
   `globalEvalWithSourceUrl` and integrates `react-refresh` (runtime injected
   into the bundle, OXC refresh transform on component modules) so component
   edits fast-refresh in place; non-boundary changes fall back to reload via
   `/message`.
3. Acceptance: editing the framework's native primitives updates the running
   simulator without reload; syntax errors surface in LogBox and recover.

### Phase 6 — RSC on native

1. Flight client on Hermes: use the react-server-dom client runtime that
   `@vitejs/plugin-rsc` wires for browsers, with real incremental streaming —
   no buffered fallback. Polyfill whatever Hermes/RN lack: web streams
   (`web-streams-polyfill`), `TextEncoder`/`TextDecoder`, and a fetch that
   exposes `response.body` as a `ReadableStream` with true incremental
   delivery (`react-native-fetch-api` over RN networking's text streaming,
   dropping to `XMLHttpRequest` incremental events if needed). Polyfills are
   injected by the native environment's bundle prelude, not imported by app
   code.
2. Client reference loading on native: plugin-rsc resolves client references
   through its browser manifest; implement the native equivalent — a static
   registry compiled into the native bundle containing only framework
   primitives (`components/native/*`). Unknown references are a hard error:
   that's the SDUI guarantee that app code never ships.
3. `native-entry.ts` fetches `/?platform=ios|android` (flight variant),
   decodes, renders via `use()` inside an error boundary; navigation/refetch
   comes later.
4. Acceptance: server component tree renders on both simulators; editing
   `example/app/index.tsx` re-renders via RSC HMR push (server component
   change → new payload → re-render, no bundle rebuild).

### Phase 7 — DOM → RN intrinsics

1. Implement the mapping in the `flypath` jsx runtime: on native-platform
   requests, `jsx("h1", props)` becomes `jsx(H1, props)` where `H1` is the
   client reference to `components/native/h1.tsx` (a `Text` with
   heading-scale styles, `role="heading"`). Web requests pass `"h1"` through
   untouched.
2. Platform detection: `platform.ts` AsyncLocalStorage seeded per request in
   `server-entry.tsx` from the query/header the native entry sends.
3. Where a compile-time pass is needed (later: props/style translation,
   validating unsupported tags at build time), implement it as an OXC
   transform inside the rsc environment — no Babel outside the RN Flow strip.
4. Acceptance: `<h1>Hello World!</h1>` renders as native text on iOS and
   Android and as a real `<h1>` on web, from the unchanged example app.

## Key decisions

- **Single dev server, port 8081.** Web pages, flight payloads, Hermes
  bundles, and every Metro-protocol/debug endpoint share one Vite server, so
  RN defaults just work and there is one HMR brain.
- **Babel is quarantined.** Only `react-native` package internals (Flow) go
  through Babel/hermes-parser, cached aggressively. All first-party and app
  transforms use OXC.
- **SDUI boundary = client reference registry.** The native bundle's manifest
  is closed: framework primitives and native modules only. The server can
  never cause app code to be required on the device.
- **No community CLI.** Simulator/emulator orchestration is `xcrun simctl`,
  `xcodebuild`, `gradlew`, `adb` invoked from our cac commands; the only RN
  tooling package we reuse is `@react-native/dev-middleware` (and
  `react-refresh`), which are CLI-independent.
- **RN pinned to 0.87.x.** The Flow-strip cache, templates, and
  dev-middleware wiring are version-sensitive, and 0.87 is what makes the
  SPM-only iOS story possible.

## Risks / open questions

- **Hermes bundle pipeline is the critical path.** Serving a coherent CJS
  graph from Vite's dev pipeline (Metro's job) is the largest unknown; the
  standalone-Hermes smoke test in Phase 3 exists to de-risk it before device
  debugging starts.
- **Streams on Hermes**: incremental delivery must be verified end-to-end
  (RN networking → fetch polyfill → web-streams → flight client), since a
  silently-buffering layer anywhere in that chain defeats streaming; add a
  chunked-response test that asserts first-chunk render before the response
  completes.
- **SPM-only iOS is new ground**: RN 0.87's SPM support is fresh, and
  third-party native modules mostly still assume CocoaPods; our templates and
  (eventual) native-module story target SPM exclusively, so anything
  pods-only is out of scope by design.
- **New Architecture surprises** (Fabric view configs, TurboModule init order)
  in hand-rolled shells; templates stay as close to RN's reference app
  template as possible.
- **plugin-rsc internals**: we depend on its environment/manifest structure to
  add a fourth consumer of the client graph; may require pinning its version
  and reading its source.
- **HMR protocol drift**: Metro's `/hot` message shapes change across RN
  releases; covered by the version pin plus protocol tests against the
  HMRClient source of the pinned RN.
