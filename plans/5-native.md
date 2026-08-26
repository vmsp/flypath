# Flypath — native modules and components plan

## Goal

`"use native"` gives app code typed access to platform capabilities and
platform UI, with the implementation written in Kotlin, Swift or C++ — and
zero glue code on either side.

```ts
// app/battery.ts
"use native";

import type { ComponentType } from "react";

export declare function printHello(): void;

export declare function batteryLevel(): Promise<number>;

export interface WebViewProps {
  url: string;
}

export declare const WebView: ComponentType<WebViewProps>;
```

```swift
// app/battery.swift
import SwiftUI

func printHello() {
  print("Hello!")
}

func batteryLevel() async -> Double {
  UIDevice.current.isBatteryMonitoringEnabled = true
  return Double(UIDevice.current.batteryLevel)
}

struct WebView: View {
  var url: String
  var body: some View { WebViewRepresentable(url: URL(string: url)!) }
}
```

```kotlin
// app/battery.kt
import androidx.compose.runtime.Composable

fun printHello() {
  println("Hello!")
}

suspend fun batteryLevel(): Double = withContext(Dispatchers.IO) { ... }

@Composable
fun WebView(url: String) {
  AndroidView(factory = { WebView(it).apply { loadUrl(url) } })
}
```

That is the entire native-side surface: plain top-level functions, a plain
SwiftUI `View`, a plain `@Composable`. No protocol to conform to, no
registration call, no spec file, no `nitro.json`, no `codegenConfig`. The
declarations in `battery.ts` are the spec; everything between them and JSI is
generated.

The browser implementation lives in `app/battery.web.tsx`. Inline annotation
works too, and there the function body _is_ the browser implementation:

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
// app/hash.cpp
#include "hash.flypath.h"

namespace flypath::app_hash {
std::string fingerprint(const std::string& input) { ... }
}
```

## The core idea: `"use native"` is `"use client"` with a native body

Flypath already has two reference systems that do the same thing — turn a
module into an opaque id on the server and resolve that id to real code
somewhere else. Native modules do not add a third; they add one more
resolution target to the client-reference system:

| directive      | server holds | web resolves to  | device resolves to     |
| -------------- | ------------ | ---------------- | ---------------------- |
| `"use client"` | reference id | browser chunk    | native chunk (fetched) |
| `"use server"` | the code     | reference id     | reference id           |
| `"use native"` | reference id | `*.web.ts` chunk | JSI binding (baked in) |

So a `"use native"` module is a `"use client"` module whose implementation
happens to be compiled into the app binary. That buys, for free:

- `<WebView url="..." />` inside a **server component** — the reference
  serializes into the flight payload exactly like any client component,
- `printHello` passed as a prop to a client component,
- `import { batteryLevel } from "./battery.ts"` inside a **client
  component** — the native chunk imports a stub module,
- the closed-manifest guarantee: a payload can only name references the
  build registered.

It also keeps the SDUI story intact. Native code is the one thing that
_cannot_ be delivered from the server, and it is exactly the thing that has
no business being app logic: it is a capability of the shell. The device
binary still ships zero app code; it ships a set of typed capabilities the
server may invoke by name. A payload naming a capability the binary does not
have is a hard, well-messaged error, never a silent no-op.

Calling a `"use native"` export from a **server component** is a build-time
error — device capabilities have no server implementation.

## Where native code lives

Colocated with the module that declares it, extension = platform, mirroring
the existing `*.web.ts` convention:

```
example/app/
  battery.ts          "use native" declarations
  battery.swift       iOS implementation
  battery.kt          Android implementation
  battery.web.tsx     browser implementation
  hash.ts             "use native" declarations
  hash.cpp            both platforms
  counter.tsx         inline "use native" functions
  counter.swift       their iOS implementations
  counter.kt          their Android implementations
```

Per platform the most specific implementation wins: `.swift` for iOS, `.kt`
for Android, `.cpp` for whichever platform has no native-language sibling.
Nothing is registered anywhere; discovery is by filename.

Generated code never lands in the user's tree. It goes next to the
materialized shells, which are already wiped and regenerated on every run:

```
example/node_modules/.flypath/
  manifest.json                     the native manifest (below)
  ios/
    native/Package.swift            generated SPM package
    native/Flypath/…                generated Swift + ObjC++ adapters
    native/battery/…                symlinks to app/battery.swift + adapters
  android/
    app/src/main/jni/…              generated OnLoad.cpp, CMakeLists, adapters
    app/src/main/generated/…        generated Kotlin adapters
```

## The native manifest

One build-time pass, shared by every generator and by both shells.

`src/native/manifest.ts` scans the project the way `styles.ts` already scans
for `*.css.ts`, parses each `"use native"` module with `oxc-parser`, and
produces:

```ts
type NativeManifest = {
  hash: string;
  modules: NativeModuleEntry[];
};

type NativeModuleEntry = {
  id: string; // "app/battery.ts", the reference id
  slug: string; // "app_battery", C/Swift-safe
  functions: NativeFunction[]; // name, params, return, isAsync
  components: NativeComponent[]; // name, props, events
  types: NativeType[]; // interfaces used by the above
  impl: { ios?: string; android?: string; cpp?: string; web?: string };
};
```

Validation happens here, with source-located errors:

- a `"use native"` module may contain only `import type`, `export declare`,
  and type/interface declarations — a value body would never run,
- every declared type must be inside the lattice below,
- every module must have an implementation for each platform it is built
  for; a missing one names the file flypath expected,
- an inline `"use native"` function may not close over anything.

The manifest hash covers every declaration and is baked into both the app
binary and the JS bundle, so a stale shell is detectable (see **Dev loop**).

## JS track

### rsc environment

`"use native"` modules go through plugin-rsc's own
`transformDirectiveProxyExport` with our runtime import, producing
`registerClientReference` proxies keyed by the module path — byte-identical
in shape to what `"use client"` produces today. The rsc environment never
sees an implementation of any kind.

A build-time check rejects a call to a native reference from an rsc module
(the proxies are call-throwing already; the check turns a runtime throw into
a compile error naming the call site).

### web (client / ssr) environments

`nativeWebResolve` (a `resolveId` hook, mirror of the existing
`nativeStub`) redirects `app/battery.ts` → `app/battery.web.tsx` in the
client and ssr environments, so the reference id stays the same on every
platform while the code behind it differs. With no web sibling, it resolves
to a generated module whose exports throw
`flypath: printHello() has no web implementation (app/battery.web.ts)`.

Web implementations are ordinary flypath modules: they render intrinsics,
use the styles system, and are type-checked against the spec by importing
its declared types.

### native environments

`app/battery.ts` compiles to a binding stub:

```js
import { nativeComponent } from "flypath/native";

const m = globalThis.__flypath.native.module("app/battery");
export const printHello = m.printHello;
export const batteryLevel = m.batteryLevel;
export const WebView = nativeComponent("Flypath_app_battery_WebView", config);
```

`native.module()` returns a cached JSI object whose properties are host
functions created once at install time, so a call site is a direct
`jsi::Function` invocation — no lookup, no dispatch table, no serialization.
`nativeComponent` is plain JS in the base bundle (below); only the module
functions cross into C++.

These stubs are tiny and there is one per native module, so **all of them go
into the base bundle**, added to `NativeServer.entries()` from the manifest.
That makes native references resolvable synchronously on the device.

`client-references.ts` grows a middle tier:

1. primitives registry (baked in, synchronous),
2. **native registry** — `virtual:flypath/native-references`, generated from
   the manifest, same shape as `virtual:flypath/client-references`,
3. chunk fetch from the server origin.

### Inline directives

plugin-rsc's `transformHoistInlineDirective` does the hard part: it hoists
each annotated function to the module top level and reports its bound
variables. Flypath rejects any function with bound variables (nothing can
cross into Swift), then:

- in the rsc / native environments, replaces the hoisted function with a
  native reference keyed `app/counter.tsx#printHello`,
- in the client and ssr environments, keeps the original body — which is the
  browser implementation.

The native implementations are looked up by function name in
`counter.swift` / `counter.kt`, exactly as for a declaration module.

### Host components and view configs

A native component's JS value is a real Fabric host component. The stub's
`config` is a `PartialViewConfig` generated from the declared props, and
`nativeComponent` registers it through
`NativeComponentRegistry.get(name, () => config)`. Under bridgeless this
takes the static-view-config path, so no native round-trip is needed to
describe the component.

`nativeComponent` also wraps the host component so that native components
behave like every other flypath element:

- `style` runs through the same `nativeStyle` → `resolve` path the
  primitives use, so tokens, conditions, themes and animations work,
- the wrapper asserts `native.hasComponent(name)` at module init and throws
  a message naming the module and telling the user to rerun `flypath ios`,
- children are rejected in v1 (see **Components on the native side**).

## Native runtime library (`native/`)

Today `native/` holds one header consumed by a template. It becomes the
flypath native library — the only hand-written native code in the system,
shipped in the npm package (`files` already lists `native`).

```
native/
  cpp/
    FlypathHermesRuntime.h        (moves here unchanged)
    FlypathRuntime.{h,cpp}        install(), CallInvoker, module registry
    FlypathValue.{h,cpp}          JSI <-> C ABI value bridge
    FlypathPromise.{h,cpp}        promise creation + CallInvoker resolve
    FlypathModule.{h,cpp}         the C++ TurboModule that installs bindings
    FlypathComponent.{h,cpp}      generic Fabric Props/ShadowNode/Descriptor
    FlypathAbi.h                  the extern "C" surface Swift/Kotlin bind to
  apple/
    Package.swift                 FlypathCore (cxx) + Flypath (swift)
    Sources/FlypathCore/          symlinks into ../cpp + ObjC++ component view
    Sources/Flypath/              Swift runtime: args, promises, view registry
  android/
    CMakeLists.txt                compiled into libappmodules.so
    jni/                          fbjni: Hermes factory, components registry
    kotlin/                       Kotlin runtime: registries, ComposeView host
```

### Hermes on both platforms

`FlypathHermesRuntime.h` moves into the library unchanged and both shells
instantiate it through one line.

**iOS** keeps working as it does now, minus the per-project shim: the
`FlypathHermes.{h,mm}` pair in `templates/ios/App/` is deleted and
`AppDelegate` calls into the package instead.

```swift
override func createJSRuntimeFactory() -> UnsafeMutableRawPointer {
  return Flypath.hermesRuntimeFactory()
}
```

**Android** gets it for the first time (the `TODO` entry). `JSRuntimeFactory`
is a public abstract Kotlin class wrapping a `HybridData`, and
`DefaultReactHost.getDefaultReactHost` takes a `jsRuntimeFactory` parameter,
so the shape is exactly RN's own `HermesInstance`:

```kotlin
class FlypathHermesInstance : JSRuntimeFactory(initHybrid()) {
  companion object {
    @JvmStatic external fun initHybrid(): HybridData
    init { SoLoader.loadLibrary("appmodules") }
  }
}
```

with a JNI counterpart deriving from `JJSRuntimeFactory` and returning
`flypath::HermesRuntimeFactory` — one C++ file, ~30 lines, mirroring
`JHermesInstance`. `MainApplication` switches to the `packageList` overload
to pass it:

```kotlin
override val reactHost: ReactHost
  get() = getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages,
    jsRuntimeFactory = FlypathHermesInstance(),
    cxxReactPackageProviders = listOf { FlypathPackage.create() },
  )
```

One wrinkle: `react/runtime/JSRuntimeFactory.h`, `react/runtime/hermes/
HermesInstance.h` and `JJSRuntimeFactory.h` are not in RN's `reactnative`
prefab header set, though their symbols are in the merged
`libreactnative.so` (`OpenSourceMergedSoMapping`). The generated CMakeLists
adds the three include directories straight from the on-disk RN package —
we already interpolate `__FLYPATH_RN_DIR__` into templates.

### Installing the bindings

One C++ TurboModule, `Flypath`, registered through the delegate hook each
platform already exposes:

- iOS: `AppDelegate.getTurboModule:jsInvoker:` (optional selector on
  `RCTReactNativeFactoryDelegate`),
- Android: `CxxReactPackage` via `cxxReactPackageProviders` above.

The native prelude calls `TurboModuleRegistry.getEnforcing("Flypath")
.install()` before anything else, which creates `globalThis.__flypath.native`
with the registry captured alongside the `CallInvoker` promises need. This
is the same path Nitro takes, and it is the only path that hands us a
`jsi::Runtime` _and_ a `CallInvoker` at a defined moment.

## Modules on the native side

### The ABI

Generated C++ builds one `jsi::HostFunction` per declared function, holding
a direct pointer to the implementation. Arguments are converted from
`jsi::Value` by generated, monomorphic code — no `folly::dynamic`, no JSON,
no `NSDictionary`/`WritableMap`. A `printHello()` call is: property load,
host-function call, C call. That is the Nitro cost model, reached the same
way (compile-time-known types, everything inlined).

Swift and Kotlin are reached through a small generated shim rather than
whole-language interop:

- **Swift**: generated `@_cdecl` entry points, declared `extern "C"` on the
  C++ side. Plain Swift for the user, boring build settings, one C call of
  overhead. (Direct C++ interop, `swiftSettings: [.interoperabilityMode
(.Cxx)]`, is a drop-in upgrade later if it measures better.)
- **Kotlin**: generated fbjni call into a generated `@JvmStatic` adapter that
  forwards to the user's function. Primitives and strings go through JNI
  directly with no allocation.
- **C++**: the generated header declares the signature; the user defines it;
  a missing definition is a link error.

```swift
@_cdecl("flypath_app_battery_printHello")
func flypath_app_battery_printHello(_ args: FlypathArgsRef) {
  printHello()
}
```

Type safety comes from the call site: the generated shim calls the user's
function with the declared types, so a mismatched or missing implementation
is an Xcode / Gradle / linker error, not a runtime surprise. The generated
files carry the spec path in a header comment, and `flypath ios|android`
rewrites compiler diagnostics inside generated adapters to point back at the
declaration.

### Threading and promises

The rule is visible in the type:

- `Promise<T>` runs **off** the JS thread and resolves through the
  `CallInvoker`. The implementation is `async` in Swift, `suspend` in
  Kotlin, and returns `flypath::Promise<T>` in C++,
- anything else runs **synchronously on the JS thread** and must not block.

`main`-thread APIs therefore have to be declared async, or dispatch
themselves. The generated Swift shim wraps the call in `Task { }`, the
Kotlin shim in a coroutine on `Dispatchers.Default`; a throw becomes a
rejected promise, and a rejected promise surfaces in the flypath
`ErrorBoundary` / LogBox like any other error.

TypeScript cannot say whether an implementation throws, so the Swift shim
always calls through a `() async throws -> T` closure — a plain `async`
implementation still compiles, and the redundant-`try` warning is suppressed
on the generated target.

### Type lattice

| TypeScript             | Swift        | Kotlin         | C++                   |
| ---------------------- | ------------ | -------------- | --------------------- |
| `void`                 | `Void`       | `Unit`         | `void`                |
| `boolean`              | `Bool`       | `Boolean`      | `bool`                |
| `number`               | `Double`     | `Double`       | `double`              |
| `string`               | `String`     | `String`       | `std::string`         |
| `T[]`                  | `[T]`        | `List<T>`      | `std::vector<T>`      |
| `T \| undefined`, `T?` | `T?`         | `T?`           | `std::optional<T>`    |
| `interface`            | `struct`     | `data class`   | `struct`              |
| `"a" \| "b"`           | `enum`       | `enum class`   | `enum class`          |
| `Promise<T>`           | `async -> T` | `suspend -> T` | `flypath::Promise<T>` |
| `ArrayBuffer`          | `Data`       | `ByteArray`    | `std::span<uint8_t>`  |

Interfaces used as parameter, return or prop types are generated as value
types in each language. Function-typed parameters (callbacks) are Phase 5.
Everything outside the lattice is a manifest error naming the declaration.

## Components on the native side

### One descriptor, N names

Per-component Fabric codegen would mean hundreds of generated lines per
component and an ObjC/Java view class the user would then have to bridge to
SwiftUI/Compose by hand — the glue this plan exists to delete. Instead:
**one generic C++ implementation, registered once per component name.**

- `FlypathProps` stores props as a dynamic map; `ConcreteViewShadowNode` and
  `ConcreteComponentDescriptor` are instantiated per component over a
  generated `extern const char[]` name, which is ~4 lines of generated C++
  each,
- distinct names matter: they keep React from recycling a `WebView` host
  instance as a `Camera` when a conditional swaps them,
- typed props decoding happens in the generated Swift/Kotlin adapter, so the
  dynamic map never reaches user code.

Registration:

- **iOS**: a generated ~8-line ObjC++ `RCTViewComponentView` subclass per
  component (the descriptor provider is a class method, so one class per
  name is required), returned from `AppDelegate.thirdPartyFabricComponents`.
- **Android**: zero generated Kotlin per component — one
  `FlypathViewManager(name)` class instantiated once per component, since
  `getName()` is an instance method. Descriptors register through
  `DefaultComponentsRegistry::registerComponentDescriptorsFromEntryPoint`
  in our `JNI_OnLoad`, which is exactly the app-level hook RN calls into:
  the CMake target is named `appmodules`, which `DefaultSoLoader` already
  loads.

### iOS: SwiftUI

The generic component view hosts a `UIHostingController` and swaps its
`rootView` on prop updates. Generated Swift registers the factory,
referencing the user's type directly:

```swift
FlypathViewRegistry.register("Flypath_app_battery_WebView") { props in
  AnyView(WebView(url: props.string("url")))
}
```

Each native module compiles as its own SPM target, so `WebView`'s
memberwise initializer is `internal`-visible to its adapter and two modules
may both export a `WebView` without colliding.

### Android: Compose

The generic view is a `ComposeView`; props are held in a
`mutableStateOf(FlypathProps)` so an update recomposes rather than
rebuilding. Generated Kotlin registers a composable lambda in the user
file's own package:

```kotlin
FlypathViewRegistry.register("Flypath_app_battery_WebView") { props ->
  WebView(url = props.getString("url"))
}
```

### Deferred to later phases

- **Children.** v1 native components are leaves; hosting RN-mounted
  children inside a SwiftUI/Compose subtree is a separate problem. Declaring
  `children` is a manifest error with that message.
- **Events.** Callback props (`onLoad?: (e: { url: string }) => void`) need
  the Fabric event emitter plus `bubblingEventTypes` in the view config;
  Phase 5. Note that event props can only be passed from client components
  anyway — a server component cannot serialize a function.
- **Measurement.** Native components size themselves through Yoga props for
  now; intrinsic content sizing (a SwiftUI view that wants to measure) needs
  a custom shadow node measure function.

## Build integration

### iOS

`runIos` gains one step before `setup-apple-spm.js`: generate the native
package. It is a normal local SPM package with a target per native module,
each containing symlinks to the user's `.swift`/`.cpp` files plus the
generated adapters, and depending on the `Flypath` runtime target.

Wiring it in needs no new mechanism: flypath already passes
`--config-command` pointing at `spm-config.ts`, whose `autolinking.json` is
today `dependencies: {}`. It gains one entry for the generated package, and
RN's `generate-spm-autolinking.js` emits it into `autolinked/Package.swift`
along with the React product dependencies. The existing pipeline compiles
and links it; nothing about the Xcode injection changes.

C++ sources compile in a `.target(name: "FlypathCore")` with
`cxxSettings`; the `.swift-format` and `.clang-format` configs at the repo
root already describe the house style for both.

### Android

Three additions to the materialized Gradle project:

1. `app/src/main/jni/` gets a CMakeLists based on RN's
   `default-app-setup/CMakeLists.txt` — `project(appmodules)` plus
   `include(ReactNative-application.cmake)`, which globs `*.cpp` from that
   folder and links `ReactAndroid::reactnative`, `jsi` and `fbjni`. Flypath
   drops in its `OnLoad.cpp`, the library's `.cpp` files, the generated
   adapters, and the user's `.cpp`. `externalNativeBuild.cmake.path` points
   at it.
2. Kotlin sources come in through `android.sourceSets`, which is the only
   supported route under AGP 9 built-in Kotlin:

   ```kotlin
   android.sourceSets.named("main") {
     kotlin.directories += "<flypath>/native/android/kotlin"
     kotlin.directories += "<project>/app"
     kotlin.directories += "build/generated/flypath"
   }
   ```

   Non-`.kt` files in `app/` are ignored by the Kotlin compiler, so the
   user's TS lives happily in a Kotlin source dir.

3. Compose: `buildFeatures.compose = true`, the Compose BOM, and the
   `org.jetbrains.kotlin.plugin.compose` plugin. Whether that plugin applies
   cleanly on top of AGP 9's built-in Kotlin — without pulling in
   `org.jetbrains.kotlin.android`, which conflicts with RN's included
   build — is unverified and is the first thing Phase 0 checks.

## Dev loop

Native code changes require an app rebuild; JS changes never do. Everything
here is about making that boundary obvious instead of mysterious.

- The manifest hash is compiled into the binary and into the bundle. The
  shell sends its hash on the `/index.bundle` request; when it differs from
  the server's, the terminal prints a diff of what changed (added module,
  changed signature) and the device shows a LogBox warning naming the
  command to run. Nothing silently half-works.
- Editing `battery.ts` is an ordinary rsc-graph change: the existing watcher
  pushes `rsc-update`, the payload re-renders, reference ids are path-derived
  and stable. If the edit changed the manifest, the skew warning fires.
- Editing `battery.swift` / `battery.kt` / `battery.cpp` does nothing until
  `flypath ios|android` runs; the watcher says so explicitly rather than
  appearing to hot-reload.
- Calling a function whose binding is missing throws
  `flypath: printHello() is not in this build of the app (app/battery.ts) —
run "pnpm ios"`, through the same ErrorBoundary/LogBox path as any other
  error, with symbolicated JS frames.
- `flypath build` runs the same generators; native artifacts are compiled
  into the release binary while the JS half follows PLAN_CLIENT.md Phase 5.

## Example

`example/app` grows a native surface that exercises every path, and each
piece is checked on web, iOS and Android:

- `battery.ts` + `battery.swift` + `battery.kt` + `battery.web.tsx` — a void
  sync function, an async function, and a `WebView` component,
- `hash.ts` + `hash.cpp` + `hash.web.ts` — the C++-for-both path,
- an inline `"use native"` function inside `counter.tsx` (a client
  component) with `counter.swift` / `counter.kt` siblings — proving the
  inline shape and that native calls work from fetched chunks,
- `index.tsx` renders `<WebView url="https://react.dev" />` from the
  **server** component and shows `batteryLevel()` through a client
  component, proving payload-delivered and chunk-imported references both
  reach the binding.

## Phases

### Phase 0 — de-risk

Three spikes, each throwaway, before any framework code:

1. Compose under AGP 9 built-in Kotlin with RN's included build — a
   `@Composable` rendering inside the existing Android shell. If
   `org.jetbrains.kotlin.plugin.compose` cannot be applied, fall back in
   order: Compose in a separate Gradle module; `android.builtInKotlin=false`
   with AGP pinned back; Android Views with Compose deferred.
2. Hand-written JSI binding installed via a C++ TurboModule on both
   platforms: `globalThis.__flypath.native.module("x").ping()` round-trips to
   Swift and to Kotlin, and a promise resolves through the `CallInvoker`.
3. A SwiftUI view and a `@Composable` mounted through one generic,
   dynamically registered Fabric component, with props arriving as a dynamic
   map.

Acceptance: all three run on simulator and emulator; the Compose answer is
written down before Phase 3 starts.

### Phase 1 — the library and Hermes on both platforms

Move `FlypathHermesRuntime.h` into `native/cpp/`, build the Apple SPM
package and the Android CMake/Kotlin library around it, delete
`templates/ios/App/FlypathHermes.{h,mm}`, switch `AppDelegate` to
`Flypath.hermesRuntimeFactory()`, add `FlypathHermesInstance` and the
`packageList` overload on Android. No `"use native"` yet.

Acceptance: both shells build and boot on the existing example with the
flypath Hermes runtime, `Error.prototype.jsEngine === "hermes"` on both, ES6
block scoping active on Android as it already is on iOS, and the RN debug
stack (Dev Menu, LogBox, DevTools, Fast Refresh) is unchanged.

### Phase 2 — modules, declaration form

Manifest scanner and validator; the rsc / web / native transforms; the
native reference tier in `client-references.ts`; C++ registry, value bridge
and promises; Swift and Kotlin generators; `battery.ts` minus the component.

Acceptance: `printHello()` and `await batteryLevel()` work from a server
component's client child on iOS and Android and through `battery.web.tsx` in
the browser; a missing implementation fails the build naming the expected
file; a stale binary produces the skew warning; a rejected promise lands in
the ErrorBoundary and LogBox with symbolicated frames.

### Phase 3 — components

Generic Fabric props/shadow node/descriptor; per-name registration on both
platforms; view-config generation; the SwiftUI hosting view and the Compose
host; style integration in the generated wrapper.

Acceptance: `<WebView url="https://react.dev" />` renders from the **server**
component on both simulators and as an `<iframe>` on web; `style` (tokens,
conditions, theme) applies identically to a native component and a
primitive; a conditional swap between two native components does not recycle
the view; an unknown component name is a hard, named error.

### Phase 4 — C++ modules and inline directives

Generated headers for the C++ path and its CMake/SPM wiring; the inline
`"use native"` transform with closure rejection; `hash.ts`/`hash.cpp` and the
inline functions in `counter.tsx`.

Acceptance: `hash.cpp` serves both platforms from one file; an inline
`"use native"` function runs natively on device and runs its own body on
web; a closure over an outer variable is a build error pointing at the
capture.

### Phase 5 — events and callbacks

Callback parameters in the type lattice; the Fabric event emitter path for
component events; `bubblingEventTypes`/`directEventTypes` generation.

Acceptance: an `onLoad` prop on `WebView` fires from Swift and from Kotlin
into a client component on both platforms, and the browser implementation
fires the same shape.

### Phase 6 — polish

Diagnostic rewriting from generated adapters back to the declaration;
`flypath build` wiring for release; the "no native equivalent" error catalog;
children and intrinsic measurement decisions written up.

Acceptance: a deliberately mismatched Swift signature and a deliberately
mismatched Kotlin signature both produce an error naming `battery.ts` and
the expected signature.

## Key decisions

- **`"use native"` reuses the client-reference system.** No fourth reference
  namespace, no new payload shape, no change to the flight client — a native
  module is a client module whose chunk is the app binary.
- **Colocation, extension-as-platform.** Discovery is filenames, not
  configuration; there is no registry file to keep in sync and no autolinking
  concept for first-party native code.
- **No spec conformance for the user.** Nitro requires
  `class HybridMath: HybridMathSpec` because it cannot know where the
  implementation lives; flypath does, so the generated adapter calls the
  user's plain function and the compiler checks the call. The user writes
  what they would write in a normal SwiftUI/Compose app.
- **One generic Fabric component, registered per name.** Per-component
  codegen buys typed C++ props and costs hundreds of generated lines plus a
  hand-written bridge into Compose/SwiftUI; the dynamic-props hop is one map
  conversion per update and can be specialized later if it ever measures.
- **Threading is visible in the type.** `Promise<T>` means off-thread;
  everything else means synchronous on the JS thread. No annotations, no
  configuration.
- **Native code is a shell capability, not app code.** It is the one thing
  the server cannot deliver, and the manifest hash makes that boundary
  explicit rather than a source of silent drift.
- **RN-sanctioned hooks only.** `CxxReactPackage`,
  `getTurboModule:jsInvoker:`, `thirdPartyFabricComponents`,
  `DefaultComponentsRegistry`'s entry-point hook, `libappmodules.so`,
  `NativeComponentRegistry` static view configs, `spm.modules` autolinking —
  every integration point is one RN already offers, keeping the surface that
  can break on an RN bump small and legible.

## Risks / open questions

- **Compose under AGP 9 built-in Kotlin.** The single hardest external
  dependency: `org.jetbrains.kotlin.plugin.compose` with built-in Kotlin is
  undocumented, and the Kotlin Android plugin is already known incompatible
  with AGP 9 plus RN's included build. Phase 0 answers it first; the
  fallback ladder is written above.
- **RN headers outside the prefab.** `JSRuntimeFactory.h`,
  `HermesInstance.h` and `JJSRuntimeFactory.h` are reachable only from the
  on-disk RN package, not the published prefab header set. Include paths
  into `node_modules/react-native` work today and are the kind of thing an
  RN bump breaks loudly; keep them in one generated CMake block.
- **Swift shim vs. C++ interop.** `@_cdecl` shims are chosen for
  robustness; if complex value types make the generated boxing ugly,
  `.interoperabilityMode(.Cxx)` is the escape hatch, at the cost of build
  settings that are less forgiving.
- **One SPM target per native module** keeps `internal` visibility and
  namespacing, but many small targets slow cold builds. Measure once the
  example has a few modules; collapsing to one target only costs the
  namespacing, which can be recovered with generated `enum` wrappers.
- **Generated-code diagnostics.** A signature mismatch surfaces in generated
  Swift/Kotlin first. Phase 6's rewriting is the mitigation, but until then
  the error points at a file the user did not write.
- **Sync calls on the JS thread** are exactly as dangerous as they are in
  every JSI library: a blocking Swift function freezes the UI. The type-level
  rule is the only guard; a dev-mode timing warning past a threshold is
  cheap and worth adding if it bites.
- **Children and measurement** are genuinely unsolved here, not merely
  deferred: hosting mounted RN children inside a SwiftUI/Compose subtree
  needs an interop story on both platforms, and self-measuring native views
  need a custom shadow node. Both are follow-on plans.
- **Fabric prop diffing through a dynamic map** means every prop update
  allocates. Fine for a WebView, questionable for a native component
  animated at 60fps; the per-component typed props specialization is the
  known answer if profiling asks for it.
