# Flypath — native modules and components plan

## Goal

`"use native"` gives app code typed access to platform capabilities and
platform UI. Implementations are written in Swift and Kotlin (or C++ once for
both platforms), and the user writes zero glue: no protocols to conform to,
no registration calls, no spec files, no bridging headers.

```ts
// app/battery.ts
"use native";

import type { NativeComponent } from "flypath";

export declare function printHello(): void;

export declare function batteryLevel(): Promise<number>;

export interface WebViewProps {
  url: string;
}

export declare const WebView: NativeComponent<WebViewProps>;
```

(`ComponentType<WebViewProps>` from `react` is accepted too; `NativeComponent`
is an alias that exists so the manifest scanner and future event typing have a
name to hang on to.)

```swift
// apple/Sources/Battery.swift
import SwiftUI

func printHello() {
  print("Hello!")
}

func batteryLevel() async -> Double {
  await MainActor.run {
    UIDevice.current.isBatteryMonitoringEnabled = true
    return Double(UIDevice.current.batteryLevel)
  }
}

struct WebView: View {
  var url: String
  var body: some View { PlatformWebView(url: url) }
}
```

```kotlin
// android/src/main/kotlin/Battery.kt
import androidx.compose.runtime.Composable

fun printHello() {
  println("Hello!")
}

suspend fun batteryLevel(): Double = readBatteryLevel()

@Composable
fun WebView(url: String) {
  AndroidView(factory = { WebView(it).apply { loadUrl(url) } })
}
```

Plain top-level functions, a plain SwiftUI `View`, a plain `@Composable`.
Flypath binds by symbol name — the declarations in `battery.ts` are the spec,
and everything between them and JSI is generated.

The browser implementation is a sibling module:

```tsx
// app/battery.web.tsx
export function printHello(): void {
  console.log("Hello!");
}

export async function batteryLevel(): Promise<number> {
  return (await (navigator as any).getBattery()).level;
}

export function WebView({ url }: { url: string }) {
  return <iframe src={url} />;
}
```

Inline annotation works too; there the function body _is_ the browser
implementation:

```tsx
function printHello(): void {
  "use native";
  console.log("Hello!");
}

function WebView({ url }: { url: string }) {
  "use native";
  return <iframe src={url} />;
}
```

Alternatively one C++ file serves both platforms:

```cpp
// cpp/hash.cpp
#include "hash.flypath.h"

namespace flypath::app_hash {
std::string fingerprint(const std::string& input) { ... }
}
```

Everything ships in two new flypath-owned native libraries (one per
platform) that also absorb `FlypathHermesRuntime.h`, so instantiating
flypath's Hermes becomes a one-liner on iOS **and** Android.

## Design: `"use native"` is a client reference with a baked-in body

Flypath already turns modules into opaque ids on the server and resolves
those ids to real code somewhere else. Native modules add one more
resolution target to the client-reference system, not a new system:

| directive      | rsc env holds | web resolves to    | device resolves to     |
| -------------- | ------------- | ------------------ | ---------------------- |
| `"use client"` | reference id  | browser chunk      | native chunk (fetched) |
| `"use server"` | the code      | reference id       | reference id           |
| `"use native"` | reference id  | `*.web.tsx` module | JSI binding (baked in) |

Because a native module is just a client reference:

- `<WebView url="..." />` renders from a **server component** — the
  reference serializes into the flight payload like any client component,
- `printHello` passes as a prop across the server → client boundary,
- `import { batteryLevel } from "./battery.ts"` works in a **client
  component**, on web and in fetched native chunks,
- the closed-manifest guarantee holds: a payload can only name references
  the build registered.

The SDUI framing stays intact. Native code is the one thing the server
cannot deliver, and it is exactly the thing that is not app logic: it is a
capability of the shell. The binary still ships zero app code; it ships a
set of typed capabilities the server may invoke by name. A payload naming a
capability the binary lacks is a hard, well-messaged error.

Calling a `"use native"` function from server code throws through the
client-reference proxy with a message saying device capabilities have no
server implementation.

## Where native code lives (and why: LSP)

The hard requirement shaping this section: **editing the native files must
come with full editor tooling** — Go to Definition, autocomplete,
diagnostics — via sourcekit-lsp for Swift and clangd for C++. Both tools
need their files to belong to a real, resolvable project (an SPM package, a
compilation database). Loose colocated `.swift` files next to TS sources
satisfy neither, so native sources get real projects inside the consumer
repo.

Kotlin is the exception: JetBrains' kotlin-lsp is not usable today, so
`android/` carries no standalone Gradle project. Its sources are compiled
only by the materialized app module, and Kotlin gets no editor tooling in
v1 — a standalone project is cheap to add back the day a working Kotlin
language server exists.

```
example/
  app/
    battery.ts             "use native" declarations
    battery.web.tsx        browser implementation
    counter.tsx            client component with inline "use native"
  apple/
    Package.swift          scaffolded once, owned by the user
    Sources/
      Battery.swift        user code, any file layout
      .generated/          flypath-owned: shims, structs, registration
  android/
    src/main/kotlin/
      Battery.kt           user code, any file layout
      .generated/          flypath-owned
  cpp/
    hash.cpp               user code
    .generated/            flypath-owned: *.flypath.h headers, .clangd
```

Rules:

- **Scaffolded once, never overwritten.** `flypath dev` (or `ios`/`android`)
  creates `<platform>/` the first time a `"use native"` module exists.
  After that only `.generated/` is flypath's; the user may add files,
  dependencies, resources freely.
- **Generated code lives inside the user's target**, not in a build dir:
  that is what makes it visible to the LSP (autocompleting a generated
  `Track` struct works because the file is in the package) and what gives
  generated registration code `internal` access to the user's types (a
  SwiftUI `View`'s memberwise init is internal).
- **Binding is by symbol name, not file name.** Generated code calls
  `printHello()` unqualified from inside the same target; the Swift/Kotlin
  compiler finds it wherever the user put it. Exported names must therefore
  be unique across all `"use native"` modules — a manifest error otherwise.
- **The user-facing projects are React-free.** They depend only on the
  platform SDK plus flypath's support layer — the `Flypath` Swift module,
  the `dev.flypath` Kotlin package — with prop accessors,
  promise/`Promise<T>` helpers, and the view/function registries, and no
  React Native dependency. Everything that touches JSI, Fabric, or RN headers is
  generated into the materialized shell, where it consumes the registries.
  This is the load-bearing trick for LSP:
  - `swift build` succeeds standalone in `apple` (path dependency on
    `node_modules/flypath`), so sourcekit-lsp fully works in any editor,
  - user C++ includes only its generated `*.flypath.h` (plain std types, a
    small `flypath::Promise<T>`), so a generated `.clangd` file with the
    `.generated/` include path is enough for clangd — no RN include maze.
- **Generation runs inside `flypath dev`**, watching `"use native"`
  modules: edit `battery.ts`, and the generated Swift/Kotlin/C++ updates on
  disk immediately, so the editor's view is never stale.

How the real builds consume these projects:

- **iOS**: the materialized Xcode project's SPM setup adds
  `example/apple` as a local package dependency (plus the flypath runtime
  package). Same toolchain, no duplication.
- **Android**: composite/AGP-version games are avoided entirely — the
  materialized app module compiles the consumer's sources via
  `android.sourceSets` (`src/main/kotlin` plus `.generated/`), with Compose
  configured on the app module. There is only one view of these sources, so
  nothing can drift.

## The native manifest

One build-time pass shared by every generator and both shells.
`src/native/manifest.ts` scans the app graph for `"use native"` modules
(the styles plugin already demonstrates the scan shape), parses them with
`oxc-parser`, and produces:

```ts
type NativeManifest = {
  hash: string;
  modules: NativeModuleEntry[];
};

type NativeModuleEntry = {
  id: string; // "app/battery.ts" — the reference id
  slug: string; // "app_battery" — C/Swift/Kotlin-safe
  functions: NativeFunction[]; // name, params, return, isAsync
  components: NativeComponentEntry[]; // name, props
  types: NativeType[]; // interfaces / literal unions used above
  impl: { web?: string; cpp?: string };
};
```

Validation happens here with source-located errors:

- a `"use native"` declaration module may contain only `import type`,
  `export declare`, and type declarations — a value body would never run,
- every referenced type must be inside the lattice below,
- exported names must be unique across all native modules,
- an inline `"use native"` function may not capture outer variables and
  must be fully annotated (params and return),
- components must be declared `NativeComponent<P>` / `ComponentType<P>`
  where `P` resolves to an object type in the lattice; `children` is a
  manifest error in v1 (see deferred list).

### Type lattice

| TypeScript             | Swift        | Kotlin         | C++                    |
| ---------------------- | ------------ | -------------- | ---------------------- |
| `void`                 | `Void`       | `Unit`         | `void`                 |
| `boolean`              | `Bool`       | `Boolean`      | `bool`                 |
| `number`               | `Double`     | `Double`       | `double`               |
| `string`               | `String`     | `String`       | `std::string`          |
| `T[]`                  | `[T]`        | `List<T>`      | `std::vector<T>`       |
| `T \| undefined`, `T?` | `T?`         | `T?`           | `std::optional<T>`     |
| `interface`            | `struct`     | `data class`   | `struct`               |
| `"a" \| "b"`           | `enum`       | `enum class`   | `enum class`           |
| `Promise<T>`           | `async -> T` | `suspend -> T` | `flypath::Promise<T>`  |
| `ArrayBuffer`          | `Data`       | `ByteArray`    | `std::vector<uint8_t>` |

Interfaces become value types generated into `.generated/` in each
language — the user's functions accept and return them, with autocomplete.
Function-typed values (callbacks, component event props) are a later phase.
Anything outside the lattice is a manifest error naming the declaration.

The manifest hash covers every declaration and is baked into both the app
binary and the JS bundle so skew is detectable (see **Dev loop**).

## JS pipeline

### rsc environment

`"use native"` modules are transformed exactly like `"use client"` ones —
`registerClientReference` proxies keyed by module path (plugin-rsc's
`transformDirectiveProxyExport` from `@vitejs/plugin-rsc/transforms`, run by
flypath so the directive name differs but the id scheme matches). The rsc
environment never sees an implementation of any kind.

### client / ssr environments (web)

A `resolveId` hook (shape of the existing `nativeStub`) redirects
`app/battery.ts` → `app/battery.web.tsx` in web environments, so one
reference id resolves to different code per platform. With no web sibling,
it resolves to a generated module whose exports throw
`flypath: printHello() has no web implementation (expected app/battery.web.ts)`.
Web implementations are ordinary flypath modules — intrinsics, styles, the
lot — and are type-checked against the spec by the manifest (export parity)
and by TS (importing the spec's types).

### native environments

`app/battery.ts` compiles to a generated binding stub:

```js
import { nativeComponent, nativeModule } from "flypath/native";

const m = nativeModule("app/battery");
export const printHello = m.printHello;
export const batteryLevel = m.batteryLevel;
export const WebView = nativeComponent("Flypath_app_battery_WebView", config);
```

`nativeModule()` returns the cached JSI object the binary installed —
its properties are host functions created once at install time, so a call
site is a direct `jsi::Function` invocation. `nativeComponent` is plain JS.

Stubs are tiny, one per module, so **all of them join the base bundle**
(added to `NativeServer.entries()` from the manifest) and register in a new
middle tier of the client-reference loader:

1. primitives registry (baked in, synchronous),
2. **native registry** — `virtual:flypath/native-references`, generated
   from the manifest, keyed by the same reference ids,
3. chunk fetch from the server origin.

A client-component chunk importing `battery.ts` resolves to the same stub,
which the chunk build excludes as a base module — no duplication.

### Inline directives

plugin-rsc's `transformHoistInlineDirective` hoists annotated functions and
reports captured variables. Flypath rejects any capture (nothing can cross
into Swift), then per environment:

- rsc / native: the hoisted function becomes a native reference keyed
  `app/counter.tsx#printHello`; the native stub binds it like a declared
  function,
- client / ssr: the original body is kept — it is the web implementation.

Native implementations are found by symbol name in the platform projects,
same as the declaration form. Inline `"use native"` is valid in client
modules only (a server component has no business defining a device
capability inline); the manifest says so with a source location.

### Components on the JS side

The JS value of a native component is a real Fabric host component:
`nativeComponent` builds a `PartialViewConfig` from the declared props and
registers it through `NativeComponentRegistry.get(name, () => config)` —
the bridgeless static-view-config path, no native round-trip. RN's own
codegen is not reused here: its input format (TurboModule specs,
`codegenConfig`) is the registration ceremony this plan deletes, and a
`PartialViewConfig` from the manifest is a few lines per component.

The wrapper also makes native components behave like flypath elements:

- `style` runs through the same style pipeline as the primitives (tokens,
  conditions, themes, animations), resolved to a plain RN style before it
  reaches the host component,
- module init asserts the binary knows the name and otherwise throws
  `flypath: <WebView> is not in this build of the app — run "pnpm ios"`,
- `children` rejected in v1.

## The flypath native libraries

Today one header is consumed by a template copy. It becomes two real
libraries shipped in the npm package (`files` lists them alongside `dist`
and `templates`), the only hand-written native code in the system, living
at the root of the package:

```
Package.swift               targets: Flypath (React-free Swift),
                            FlypathAbi (the extern "C" surface)
cpp/                        shared core, compiled into both shells
  FlypathHermesRuntime.h    moves here unchanged
  FlypathRuntime.{h,cpp}    install(), CallInvoker capture, registries
  FlypathValue.{h,cpp}      jsi::Value <-> C ABI conversions
  FlypathPromise.{h,cpp}    promise creation, CallInvoker resolution
  FlypathModule.{h,cpp}     the C++ TurboModule exposing install()
  abi/                      extern "C" surface Swift/Kotlin bind against
apple/
  *.swift                   the Flypath module: React-free Swift
  core/                     C++/ObjC++: FlypathAppDelegate, component view,
                            generic Fabric Props/ShadowNode/Descriptor
android/
  dev/flypath/              the dev.flypath package: registries, FlypathArgs,
                            promise helpers, and the RN-facing view manager
                            and Hermes factory
  jni/                      fbjni glue: Hermes factory, ABI bridge,
                            OnLoad.cpp
```

### Hermes on both platforms

`FlypathHermesRuntime.h` moves into `cpp/` and both shells get the
flypath runtime through one line each.

**iOS**: `FlypathCore` ships an ObjC++ `FlypathAppDelegate : RCTAppDelegate`
that overrides `createJSRuntimeFactory` (returning
`flypath::createHermesRuntimeFactory()`), `getTurboModule:jsInvoker:`
(returning the `Flypath` C++ TurboModule — this selector traffics in
`std::shared_ptr`, which Swift cannot override, hence the ObjC++ base
class), and `thirdPartyFabricComponents`. The app template becomes:

```swift
@main
class AppDelegate: FlypathAppDelegate { ... }
```

and the per-project `FlypathHermes.{h,mm}` shim plus the header copy in
`runIos` are deleted.

**Android** (closing the `createHermesRuntimeFactory on Android` TODO):
`dev.flypath` ships

```kotlin
class FlypathHermesInstance : JSRuntimeFactory(initHybrid())
```

backed by a ~30-line JNI counterpart in `jni/` that derives from
`JJSRuntimeFactory` and returns `flypath::HermesRuntimeFactory` — the exact
shape of RN's own `HermesInstance`. `MainApplication` switches to the
`packageList` overload:

```kotlin
override val reactHost: ReactHost
  get() = getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages,
    jsRuntimeFactory = FlypathHermesInstance(),
  )
```

Header caveat to encode in the generated CMake: `JJSRuntimeFactory.h` is
not in RN's prefab header set (its symbols are in the merged
`libreactnative.so`), so one include directory is added straight from the
on-disk RN package — the templates already interpolate `__FLYPATH_RN_DIR__`.

### Installing the bindings

The `Flypath` C++ TurboModule is registered through hooks each shell
already owns: `FlypathAppDelegate.getTurboModule:jsInvoker:` on iOS,
`DefaultTurboModuleManagerDelegate::cxxModuleProvider` in the shell's
`OnLoad.cpp` on Android (`libappmodules.so` is loaded by RN's default
SoLoader without any extra wiring). The native prelude calls
`TurboModuleRegistry.getEnforcing("Flypath").install()` first thing, which
creates `globalThis.__flypath.native` with the registry contents and the
`CallInvoker` promises need. This is the only RN path that hands over a
`jsi::Runtime` _and_ a `CallInvoker` at a defined moment — the same one
Nitro uses.

## Modules on the native side

### The call path

Generated C++ builds one `jsi::HostFunction` per declared function holding
a direct pointer to the generated adapter. Argument conversion is
monomorphic generated code — no `folly::dynamic`, no JSON, no maps. A
`printHello()` call is: property load, host-function call, C call. That is
the Nitro cost model, reached the same way: types known at generation time,
everything inlined.

Swift and Kotlin are reached through thin generated shims:

- **Swift**: `@_cdecl` entry points declared `extern "C"` on the C++ side.

  ```swift
  @_cdecl("flypath_app_battery_printHello")
  func flypath_app_battery_printHello(_ args: FlypathArgsRef) {
    printHello()
  }
  ```

  (Swift's C++ interop mode is a drop-in upgrade later if the boxing for
  complex types measures badly; `@_cdecl` keeps build settings boring.)

- **Kotlin**: generated fbjni call into a generated `@JvmStatic` adapter
  forwarding to the user's function; primitives and strings cross JNI with
  no extra allocation.
- **C++**: the generated `*.flypath.h` declares the signature in a
  per-module namespace; the user defines it; a missing definition is a link
  error.

Type safety comes from the call site: the generated shim calls the user's
function with the declared types, so a wrong or missing implementation is
a Swift/Kotlin/link error at build time, not a runtime surprise. The
generated files name the spec file at the top, and a later phase rewrites
compiler diagnostics inside `.generated/` to point at the declaration.

Registration is compiled, not reflected: generation emits one
`@_cdecl("FlypathRegisterAll")` / `@JvmStatic fun registerAll()` per app
that fills the flypath registries with function pointers and view
factories; `FlypathCore` calls it during `install()`.

### Threading and promises

The rule is visible in the type:

- `Promise<T>` runs **off** the JS thread and resolves through the
  `CallInvoker`. The implementation is `async` in Swift, `suspend` in
  Kotlin, returns `flypath::Promise<T>` in C++. The generated shim wraps
  the Swift call in a `Task`, the Kotlin call in a coroutine; a throw
  becomes a rejection and lands in the ErrorBoundary / LogBox like any
  other error. TypeScript cannot say whether an implementation throws, so
  the generated Swift shim awaits through a helper typed
  `() async throws -> T` — throwing and non-throwing user functions both
  compile warning-free.
- everything else runs **synchronously on the JS thread** and must not
  block; main-thread APIs must be declared `Promise` (and hop internally,
  as `batteryLevel` does with `MainActor.run`).

## Components on the native side

### One generic descriptor, N names

Per-component Fabric codegen would generate hundreds of lines per component
plus a UIView/ViewManager class the user would then bridge to
SwiftUI/Compose by hand — the glue this plan exists to delete. Instead one
generic C++ implementation is instantiated per component name:

- `FlypathProps` parses props into a dynamic map;
  `ConcreteViewShadowNode`/`ConcreteComponentDescriptor` are stamped out
  over a generated `extern const char[]` name (~4 generated lines per
  component). Distinct names keep React from recycling a `WebView` host
  view as some other component when a conditional swaps them.
- Typed decoding happens in the generated Swift/Kotlin adapter, so the
  dynamic map never reaches user code.

Registration:

- **iOS**: a generated ~8-line ObjC++ `RCTViewComponentView` subclass per
  name (descriptor provider is a class method, so one class per name),
  returned from `FlypathAppDelegate.thirdPartyFabricComponents`. The view
  hosts a `UIHostingController` and swaps `rootView` on prop updates.
  Generated Swift registers the factory against the user's type:

  ```swift
  FlypathViewRegistry.register("Flypath_app_battery_WebView") { props in
    AnyView(WebView(url: props.string("url")))
  }
  ```

- **Android**: one `FlypathViewManager(name)` Kotlin class instantiated per
  name; descriptors register through
  `DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint`
  in the shell's `OnLoad.cpp`. The host view is a `ComposeView` whose
  content reads a `mutableStateOf(FlypathProps)`, so an update recomposes
  instead of rebuilding:

  ```kotlin
  FlypathViewRegistry.register("Flypath_app_battery_WebView") { props ->
    WebView(url = props.getString("url"))
  }
  ```

### Deferred (explicitly, with errors today)

- **Children**: v1 native components are leaves; declaring `children` is a
  manifest error saying so. Hosting RN-mounted children inside a
  SwiftUI/Compose subtree is its own follow-on plan.
- **Events**: callback props need the Fabric event emitter and
  `bubblingEventTypes` generation — Phase 5. (Event props can only come
  from client components anyway; a server component cannot serialize a
  function.)
- **Measurement**: native components size through Yoga props; intrinsic
  content sizing needs a custom shadow-node measure function later.

## Build integration

### iOS

`runIos` gains a generate step before `setup-apple-spm.js`. Wiring uses the
hook flypath already owns: `spm-config.ts` (the `--config-command`) grows
two `dependencies` entries — the flypath runtime package
(`node_modules/flypath`) and the consumer package (`<root>/apple`) — and
RN's `generate-spm-autolinking.js` emits them
into the autolinked `Package.swift` it already writes. The generated
React-touching Swift/ObjC++ (component view subclasses, `@_cdecl` shims'
C++ callers) lands in the materialized shell, which is wiped and
regenerated every run.

### Android

Additions to the materialized Gradle project:

1. `app/src/main/jni/CMakeLists.txt` following RN's default-app-setup:
   `project(appmodules)` + `include(ReactNative-application.cmake)`, adding
   flypath's `cpp` + `android/jni`, the generated adapters, and the
   user's `cpp/*.cpp`; links `ReactAndroid::reactnative`,
   `ReactAndroid::jsi`, `fbjni`, and the hermes prefab (the Hermes factory
   needs `hermes-engine` headers), plus the one raw RN include dir noted
   above.
2. Kotlin sources via `android.sourceSets` on the app module: `dev.flypath`
   from `node_modules/flypath/android`, the consumer's
   `src/main/kotlin` (including `.generated/`). Non-Kotlin files in those
   trees are ignored by the Kotlin compiler.
3. Compose on the app module: `buildFeatures.compose = true`, the Compose
   BOM, and `org.jetbrains.kotlin.plugin.compose`. Whether that plugin
   applies on top of AGP 9's built-in Kotlin — without dragging in
   `org.jetbrains.kotlin.android`, which is incompatible with AGP 9 and
   RN's included build — is unverified and is Phase 0's first question.

## Dev loop

Native code changes require an app rebuild; JS changes never do. The work
here is making that boundary obvious:

- The manifest hash is compiled into the binary (a generated constant
  registered at install) and known to the server. The shell appends it to
  the `/index.bundle` request; on mismatch the terminal prints what changed
  (added module, changed signature) and the device shows a LogBox warning
  naming the command to run. Nothing silently half-works.
- Editing `battery.ts` regenerates the platform shims on disk (keeping the
  LSP view fresh) and rides the ordinary `rsc-update` push; if the manifest
  changed, the skew warning fires.
- Editing `Battery.swift` / `Battery.kt` / `hash.cpp` does nothing until
  `flypath ios|android`; the watcher says so explicitly rather than
  appearing to hot-reload.
- Calling a function the binary lacks throws
  `flypath: printHello() is not in this build of the app (app/battery.ts)
— run "pnpm ios"` through the ErrorBoundary / LogBox with symbolicated
  frames.
- `flypath build` runs the same generators for release; the JS half of
  release follows the client-components plan's Phase 5.

## Editor support checklist (tested, not assumed)

Verified as part of acceptance, per platform:

- `example/apple`: `swift build` passes standalone; in VS Code/Zed
  (sourcekit-lsp) and Xcode: autocomplete on `Flypath` helpers and
  generated structs, Go to Definition from `WebView` usage in generated
  registration into the user's struct, live diagnostics on a signature
  mismatch.
- `example/cpp`: clangd resolves `hash.flypath.h` via the generated
  `.clangd`; Go to Definition into the generated header.
- `app/battery.ts` / `battery.web.tsx`: plain tsserver — already works.

## Example

`example/app` plus the platform projects grow a surface that exercises
every path,
each verified on web, iOS simulator, and Android emulator:

- `battery.ts` + Swift/Kotlin/web implementations — a sync void function,
  an async function, a `WebView` component,
- `hash.ts` + `cpp/hash.cpp` + `hash.web.ts` — the C++-once path,
- an inline `"use native"` function in `counter.tsx` with Swift/Kotlin
  implementations — proving the inline shape and calls from fetched
  chunks,
- `index.tsx` renders `<WebView url="https://react.dev" />` from the
  **server** component and shows `batteryLevel()` through a client
  component — payload-delivered and chunk-imported references both hit the
  binding.

## Phases

### Phase 0 — de-risk spikes (throwaway)

1. **Compose under AGP 9 built-in Kotlin** with RN's included build: a
   `@Composable` inside the existing Android shell. Fallback ladder if the
   Compose plugin won't apply: Compose in a separate included build;
   `android.builtInKotlin=false` with AGP pinned back; Android Views with
   Compose deferred.
2. **Hand-written JSI binding** installed via the C++ TurboModule on both
   platforms: a sync call reaches Swift and Kotlin, a promise resolves
   through the `CallInvoker`.
3. **A SwiftUI view and a `@Composable`** mounted through one generic,
   per-name-registered Fabric component with dynamic props.
4. **Standalone LSP**: a mock `apple` package resolves in sourcekit-lsp with
   a path dependency on a mock Flypath target.

Acceptance: all four run on simulator + emulator (4: in the editor); the
Compose answer is written down before Phase 3.

### Phase 1 — the libraries and Hermes everywhere

Build `cpp`, `apple`, `android` around
`FlypathHermesRuntime.h` (moved, unchanged); `FlypathAppDelegate` on iOS
(template shim + header copy deleted); `FlypathHermesInstance` + the
`packageList` overload on Android; `install()` creating
`globalThis.__flypath.native` from the prelude. No `"use native"` yet.

Acceptance: both shells build and boot the existing example on flypath's
Hermes — `Error.prototype.jsEngine === "hermes"` and ES6 block scoping
active on **both** platforms (today Android runs stock Hermes); web
untouched; Dev Menu, LogBox, DevTools, Fast Refresh unchanged.

### Phase 2 — modules, declaration form

Manifest scanner + validator; rsc/web/native transforms; native registry
tier in `client-references.ts`; generators for Swift, Kotlin, and the
binding C++; consumer project scaffolding; `battery.ts` minus the
component; skew hash.

Acceptance: `printHello()` and `await batteryLevel()` work from a client
component on iOS and Android and through `battery.web.tsx` in the browser;
calling from a server component throws the "no server implementation"
error; a missing implementation is a native build error whose diagnostic
involves the right symbol; a stale binary triggers the skew warning; a
rejected promise lands in ErrorBoundary/LogBox symbolicated; the Phase 2
rows of the editor checklist pass.

### Phase 3 — components

Generic Fabric component; per-name registration both platforms; view-config
generation; `UIHostingController` and `ComposeView` hosts; style
integration in the wrapper.

Acceptance: `<WebView url="https://react.dev" />` renders from the server
component on both simulators and as an `<iframe>` on web; `style` (tokens,
conditions, theme) applies to a native component like a primitive; prop
updates recompose/re-render in place; a conditional swap between two
native components does not recycle views; an unknown name is a hard, named
error.

### Phase 4 — C++ modules and inline directives

`*.flypath.h` generation + `.clangd`; CMake/SPM wiring for user C++; the
inline transform with capture rejection; `hash.ts`/`hash.cpp` and the
inline functions in `counter.tsx`.

Acceptance: `hash.cpp` serves both platforms from one file and
`hash.web.ts` serves the browser; an inline function runs natively on both
devices and runs its own body on web; a capture is a build error pointing
at the captured variable; clangd row of the checklist passes.

### Phase 5 — events and callbacks

Callback parameters in the lattice; Fabric event emitter path;
`bubblingEventTypes`/`directEventTypes` in generated view configs.

Acceptance: an `onLoad` prop on `WebView` fires from Swift and Kotlin into
a client component on both platforms; the web implementation fires the same
shape.

### Phase 6 — polish

Diagnostic rewriting from `.generated/` back to declarations; release
(`flypath build`) wiring; the error catalog for unsupported declarations;
write-ups for children + measurement.

Acceptance: deliberately mismatched Swift and Kotlin signatures each
produce an error naming `battery.ts` and the expected signature; release
builds of the example pass the full test matrix.

## Key decisions

- **`"use native"` rides the client-reference system.** No fourth
  reference namespace, no payload change, no flight-client change — a
  native module is a client module whose chunk is the app binary.
- **Real projects in `apple/`, `android/`, and `cpp/`, not colocated loose
  files.** LSP needs a package/Gradle/compdb context; a scaffolded-once project provides it and
  gives users a normal place for platform dependencies. Specs and web
  implementations stay colocated in `app/`.
- **User-facing native projects are React-free** (depend only on
  `Flypath`/`dev.flypath`), which is what makes standalone `swift build`/Gradle sync —
  and therefore full LSP — possible. All React coupling lives in generated
  shell code and flypath's own libraries.
- **Swift 6 language mode, no opt-out.** `swift-tools-version: 6.0`
  already defaults to it, so no target sets `swiftLanguageMode`. The C ABI
  entry points stay nonisolated — they run on whichever thread called into
  the runtime — except the view surface: `FlypathHost` and the generated
  `flypath_view_*` factories are `@MainActor`, since they touch UIKit and
  are only ever called from the Fabric component view on the main thread.
  A user function that reaches for main-actor state from the JS thread is
  then a compile error rather than a race. The Xcode shell target is
  `SWIFT_VERSION = 6.0` too — its `AppDelegate` overrides `RCTAppDelegate`,
  whose headers are not Sendable-audited, but nothing in those overrides
  crosses an isolation boundary, so it compiles clean.
- **`apple/core/` is a directory because SwiftPM forces it.** A target
  cannot mix Swift and ObjC++ sources, and `core/` is never compiled in
  place: its files are symlinked, flattened, into the generated
  `FlypathCore` package that links React headers, with `core/include/`
  marking that package's public headers. The Swift module sits at `apple/`
  and excludes `core/`. Android has no such constraint — every Kotlin file
  compiles into the app module, so `android/dev/flypath/` is one flat
  package and only the fbjni C++ in `android/jni/` is split out.
- **Binding is by symbol name.** No file-name pairing, no registration:
  the generated call site makes the compiler do discovery and type
  checking. Uniqueness across modules is enforced by the manifest.
- **No spec conformance for the user.** Nitro needs
  `class HybridMath: HybridMathSpec` because it cannot know where the
  implementation lives; flypath does, so the generated adapter calls the
  user's plain function and the compiler checks the call.
- **One generic Fabric component, N names; RN codegen not reused.** Typed
  per-component codegen buys typed C++ props at the cost of exactly the
  ceremony and glue this plan deletes; the dynamic-map hop is one
  conversion per update, specializable later if profiling asks.
- **Threading visible in the type.** `Promise<T>` = off-thread via
  CallInvoker; everything else = sync on the JS thread. No annotations.
- **RN-sanctioned hooks only**: `getTurboModule:jsInvoker:`,
  `thirdPartyFabricComponents`, `cxxModuleProvider`,
  `registerComponentDescriptorsFromEntryPoint`, `libappmodules.so`,
  `JSRuntimeFactory`, static view configs, SPM autolinking's config
  command. Every integration point already exists in RN, keeping the
  break-on-upgrade surface small and legible.

## Risks / open questions

- **Compose under AGP 9 built-in Kotlin** is the hardest external
  unknown (the Kotlin Android Gradle plugin is already known-incompatible
  with this setup). Phase 0 answers it first; the fallback ladder is
  written above.
- **Kotlin has no editor tooling.** kotlin-lsp does not work, so
  `Battery.kt` is edited blind and mistakes surface as build errors from
  `flypath android`. Restoring a standalone Gradle project for the IDE is
  the recovery path, at the cost of a second view of the same sources that
  can drift in dependency config.
- **RN headers outside the prefab** (`JJSRuntimeFactory.h`): include paths
  into `node_modules/react-native` break loudly on RN bumps; keep them in
  one generated CMake block.
- **`@_cdecl` boxing for complex value types** may get ugly; Swift C++
  interop is the measured escape hatch.
- **Sync calls block the JS thread** exactly as in every JSI library; the
  type rule is the guard, and a dev-mode duration warning is cheap to add
  if it bites.
- **Dynamic props allocate per update** — fine for a WebView, wrong for a
  60fps-animated component; per-component typed specialization is the
  known answer if profiling asks.
- **Generated-code diagnostics** point at files the user didn't write
  until Phase 6's rewriting lands; the generated files' header line naming
  the spec is the interim mitigation.
- **Symbol-name uniqueness across modules** is a global constraint users
  may dislike at scale; per-module namespacing (generated enum/object
  wrappers) is the recovery path and costs nothing to add later.
- **plugin-rsc transform reuse** (`transformDirectiveProxyExport`,
  `transformHoistInlineDirective`) deepens the internals coupling every
  prior plan flags; both are exported from `@vitejs/plugin-rsc/transforms`,
  and owning replacements via oxc is the standing fallback.
