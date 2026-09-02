# Flypath — consumer native code as libraries

## Goal

Two things the consumer owns and today cannot touch: **their native code's
declarations** and **their app's identity**.

Native code becomes a **library the shell depends on**, not a pile of sources
the shell absorbs. That gives a `"use native"` module every place a platform
expects a native module to declare itself: an `AndroidManifest.xml` for
permissions and intent filters, a `build.gradle.kts` for Gradle dependencies
and module options, `res/` and `assets/`, a `Package.swift` for SPM
dependencies — each read by the platform's own merger, with flypath writing
no merge logic at all.

App identity — name, bundle id, version, icon, launch screen, orientations —
splits by kind. **Scalars come from options on the vite plugin**
(`flypath({ bundleId: "com.acme.app" })`), the config surface the project
already has. **Files come from the overlay**: `res/` in the Android library
module, and a buildable folder pointed at `apple/Resources/` on iOS, which
needs the project template bumped to the Xcode 16 format.

iOS keeps the one thing SPM cannot express. A Swift package cannot contribute
`Info.plist` keys, entitlements, or capabilities to the app that links it, so
`NSCameraUsageDescription` needs a mechanism of its own no matter how the
code is packaged. That mechanism is a user-owned partial plist deep-merged
into the materialized one — deliberately not a cross-platform
`permissions: []` abstraction.

The shell itself stays disposable. It is a function of the native manifest
(`MainApplication.kt` interpolates the registered view names) and it is full
of absolute machine paths, so handing it to the user would mean editing their
files on every build. The overlay grows; the shell does not move.

Milestone: `example/app/camera.ts` declares a `"use native"` `CameraPreview`;
`example/android/src/main/AndroidManifest.xml` declares
`<uses-permission android:name="android.permission.CAMERA" />` and
`example/android/build.gradle.kts` pulls in `androidx.camera`;
`example/apple/Info.plist` declares `NSCameraUsageDescription`;
`example/vite.config.ts` says
`flypath({ bundleId: "dev.flypath.camera", appName: "Camera", version: "2.1" })`;
and both platforms carry the consumer's own icon and launch screen. After
`flypath android`, `apkanalyzer manifest print` on the APK lists
`android.permission.CAMERA` and `package="dev.flypath.camera"`, and the
emulator renders its fake camera feed in a Compose `"use native"` component
under the consumer's launcher icon. After `flypath ios`, `plutil -p` on the
built `App.app/Info.plist` lists `NSCameraUsageDescription` and
`CFBundleShortVersionString = 2.1`, and the app launches through the
consumer's storyboard without the termination a missing usage string causes.

## What is broken today

### Native code has nowhere to declare itself

The two platforms are already asymmetric, and only one has the problem it
looks like it has.

1. **`example/apple` is already a library.** A real SPM package
   (`ExampleNative`), scaffolded once (`scaffold.ts:106`) and added to the
   generated `FlypathCore` package as a path dependency (`apple.ts:44-62`).
   SPM dependencies, extra targets, binary targets and resources already
   work. This half of the question is answered; it has never been exercised.
2. **`example/android` is not a project at all.** `kotlinSourceDirs()`
   (`scaffold.ts:191`) returns a bare directory that `android.ts:170-176`
   splices into `android.sourceSets` of the materialized app module
   (`templates/android/app/build.gradle.kts:48-53`). No
   `AndroidManifest.xml`, no `build.gradle.kts`, no `res/`, no `assets/`, no
   dependency block, no ProGuard rules. `<uses-permission>` has literally
   nowhere to go, and neither does `implementation("androidx.camera:…")`.
3. **`dev.flypath` is a second splat into the same module.**
   `template.ts:34` interpolates `node_modules/flypath/android` into the app
   module's source set, so flypath's Kotlin and the consumer's compile as one
   blob. Plan 5's promise that user-facing native projects are React-free is
   therefore pure convention on Android: nothing stops `Battery.kt` from
   importing `com.facebook.react.*`, and today it would compile.

### App identity is not addressable at all

4. **Bundle id and application id are hardcoded** to `dev.flypath.<slug>`
   (`template.ts:92-93`). Unshippable to either store.
5. **App name is derived, not chosen** — `package.json` `name` with
   non-alphanumerics stripped (`template.ts:78`).
6. **Version and build number are constants** — `1.0` and `1`, literals in
   `templates/ios/App/Info.plist:20-22`.
7. **There is no app icon on either platform.** `templates/` contains zero
   image assets, so Android ships the default robot and iOS ships blank.
8. **The launch screen is flypath's.**
   `templates/ios/App/LaunchScreen.storyboard` is materialized and wiped, as
   is the whole `App/` directory: `runIos` does `fs.rmSync(target)` then
   `materialize("ios", …)` (`ios.ts:81-82`). Any file a user adds is
   destroyed on the next build. Same for `Info.plist`, which the project
   consumes as `INFOPLIST_FILE = App/Info.plist` with
   `GENERATE_INFOPLIST_FILE = NO` (`project.pbxproj:188-189`, `:211-212`).
   This is the hole the TODO already names for deep links: "no URL scheme is
   registered in `templates/ios/App/Info.plist` or the Android manifest — so
   nothing can deliver one."
9. **App-level build settings have no user surface** on either platform: a
   `minSdk` bump, `packagingOptions`, an extra Gradle plugin, an Xcode build
   setting, a `gradle.properties` entry.

### And the reason it cannot be fixed by handing over the projects

10. **npm-distributed native libraries do not exist.** `buildManifest` scans
    only the project root and `SKIP`s `node_modules` (`manifest.ts:71-79`,
    `:870`), so a package shipping `"use native"` modules is invisible. The
    library shape below is the prerequisite for ever changing that.

(3) is why this is a plan and not a patch: the consumer cannot become a
Gradle module until `dev.flypath` becomes something a Gradle module can
depend on.

## Field notes — prior art

Every framework that lets app authors write native code answers "where does
the permission go", and they cluster into three camps.

- **Full checked-in projects** — bare React Native, Flutter, Capacitor.
  Capacitor's docs are explicit: the native projects "should be considered
  part of your app — check them into source control, edit them in their own
  IDEs". Maximum flexibility, and every one of them needed a migration tool
  to survive its own upgrades: `npx cap migrate`, React Native's Upgrade
  Helper (rn-diff-purge), `flutter create .` and diff by hand. Capacitor's
  own issue tracker carries a long-running request to go the *other* way and
  generate the platforms from a file, citing merge conflicts, repo bloat, and
  needing Xcode installed just to change a setting.
- **Fully generated, config-driven** — Expo's Continuous Native Generation
  gitignores `android/` and `ios/` and regenerates them from `app.json` plus
  config plugins; Tauri and Cordova do the same shape. The cost is legible in
  what Expo had to build around it: a plugin API, an ordering model, and
  "dangerous mods" — an escape hatch that does regex on native files and is
  documented as not idempotent — plus a cottage industry of tooling that
  tells you which of your native edits the next prebuild will erase.
- **Disposable projects plus a user-owned overlay** — NativeScript's
  `App_Resources/` (`Android/src/main/AndroidManifest.xml`,
  `Android/app.gradle`, `iOS/Info.plist`, `iOS/build.xcconfig`, and native
  sources under `Android/src/main/java` and `iOS/src/`) and .NET MAUI's
  `Platforms/Android|iOS/`. The generated `platforms/` tree stays
  disposable; the overlay is checked in. This is item-for-item the design
  below, arrived at independently, which is either reassuring or unoriginal.

The consensus among everyone with real native code is: **let the platform's
merger do it**, and accept that iOS has no merger for the plist. Only Tauri
and partly Expo abstract over the difference, and both pay for it forever.

One gap the overlay camp historically could not close: NativeScript's own
docs concede the launch screen storyboard lives in the generated
`platforms/ios/` with "no means to store it at `App_Resources/iOS`". Xcode 16
closed that gap for everyone (below), which is a large part of why this plan
is worth writing now.

## Options considered

1. **Keep splatting sources, add a `permissions: []` config key.** Rejected:
   one axis of a four-axis problem (permissions, dependencies, resources,
   build options), and the mapping table between "camera" and each platform's
   spelling is permanent maintenance — iOS usage strings are prose the user
   writes anyway.
2. **Expo-style config plugins** — JS that mutates the materialized projects.
   Rejected for v1: the point of materializing is that the shell is
   disposable and the user's project is real. A plugin API is what you build
   when the user's project *isn't* real.
3. **Full checked-in `android/` and `ios/` projects**, generated once. The
   honest case for it is strong: LaunchScreen, icons, plist, manifest,
   signing, extra Xcode targets all just work, and `templates/`,
   `materialize()`, the plist merge and every escape hatch below get deleted.
   Rejected for flypath specifically, on three findings:
   - **The materialized projects are full of absolute machine paths.**
     `__FLYPATH_RN_DIR__`, `__FLYPATH_GRADLE_PLUGIN_DIR__` and
     `__FLYPATH_PROJECT_ROOT__` are baked into `settings.gradle.kts`,
     `build.gradle.kts`, `CMakeLists.txt` and `AppDelegate.swift`. A
     checked-in project cannot hold those; it would need RN's answer —
     relative `$(SRCROOT)/../node_modules` plus shelling out to node from
     build phases — which is a large part of why RN's build files look the
     way they do.
   - **The shell is a function of the native manifest.**
     `MainApplication.kt` interpolates `FlypathPackage(listOf(…))` from the
     registered view names, so adding a `"use native"` component changes a
     file the user would own. Flypath would have to edit the user's source on
     every build, which is Expo's dangerous-mods problem reached from the
     other direction.
   - **It contradicts the project's own stance.** AGENTS.md: no backwards
     compatibility, re-architecting is fair game. Checked-in shells turn
     every shell change into a migration guide.
4. **Disposable shell, overlay for everything the user owns** — chosen.
   Below.

The condition under which (3) wins is worth recording, because it is not
hypothetical: **app extensions and multiple targets**. Widgets, share
extensions, App Clips, watchOS apps, Android product flavors — these are
whole extra targets, and no overlay expresses them. Expo needed dangerous
mods and a third-party `apple-targets` plugin for exactly this. If flypath
ever wants them, generated shells stop paying and this decision should be
reopened.

## Shape

```
example/
  vite.config.ts               flypath({ bundleId, appName, version, … })
  app/
    camera.ts                  "use native" declarations
  android/                     ← becomes a real Gradle library module
    build.gradle.kts           scaffolded once, user-owned
    src/main/
      AndroidManifest.xml      scaffolded once — permissions, intent filters
      kotlin/
        Camera.kt              user code
        generated/             flypath-owned
      res/                     icons, splash theme, drawables — merged by AGP
    app.gradle.kts             optional, appended to the app module
    gradle.properties          optional, merged into the shell's
  apple/                       already a real SPM package
    Package.swift              scaffolded once — SPM dependencies
    Info.plist                 scaffolded once — usage strings, URL types
    App.entitlements           scaffolded once (device builds)
    App.xcconfig               optional, passed to xcodebuild
    Resources/                 ← buildable folder in the app target
      LaunchScreen.storyboard
      Assets.xcassets          AppIcon, and anything else
    Sources/
      Camera.swift             user code
      generated/               flypath-owned
```

Where each need is served:

| need                        | Android                               | iOS                              |
| --------------------------- | ------------------------------------- | -------------------------------- |
| permissions / usage strings | `src/main/AndroidManifest.xml`        | `Info.plist` (flypath merges)    |
| intent filters / URL schemes| `src/main/AndroidManifest.xml`        | `Info.plist` (flypath merges)    |
| native dependencies         | `build.gradle.kts`                    | `Package.swift`                  |
| icon, splash, drawables     | `src/main/res`                        | `Resources/` (buildable folder)  |
| module build options        | `build.gradle.kts`                    | `Package.swift` settings         |
| shrinker rules              | `consumerProguardFiles`               | n/a                              |
| app-level build options     | `app.gradle.kts`, `gradle.properties` | `App.xcconfig`                   |
| entitlements / capabilities | n/a                                   | `App.entitlements`               |
| name, id, version, orient.  | `flypath({ … })`                      | `flypath({ … })`                 |

Everything in the Android column is read by AGP's own manifest, resource and
dependency mergers. Flypath's entire contribution on that platform is two
lines of `settings.gradle.kts`.

## Configuration: options on the vite plugin

`flypath()` already takes options (`index.ts:24-26`, `:138`), and
`vite.config.ts` is the config file the project already has. Identity scalars
go there rather than into a new `flypath.config.ts` or a `package.json` key:

```ts
export default defineConfig({
  plugins: [
    flypath({
      appName: "Camera",
      bundleId: "dev.flypath.camera",
      version: "2.1",
      build: 7,
      ios: { minimumVersion: "15.0", orientations: ["portrait"] },
      android: { applicationId: "dev.flypath.camera", minSdk: 26 },
    }),
  ],
});
```

Every field is optional and every current default is preserved, so no
existing project changes. `bundleId` defaults `ios`/`android` ids that can
still be set apart when a store forces it.

**Reading them from the native commands.** `runIos` and `runAndroid` are
invoked straight from `cli.ts` and never load the Vite config today. They
gain one step: `resolveConfig({ root }, "build")`, then find the
`flypath:config` plugin in the resolved plugin list and read its options off
`plugin.api` — Vite's sanctioned channel for a plugin to expose data, and the
reason to stash the options there rather than in a module-level variable.
`resolveConfig` is used rather than `loadConfigFromFile` because it flattens
the nested `PluginOption[]` that `flypath()` returns.

This also settles an existing split: `--port` is a CLI flag defaulting to
8081 (`cli.ts:38`, `:46`) *and* `flypath({ port })` defaults to 8081
(`index.ts:139`), independently. After this, the plugin option is the value
and the flag overrides it.

`projectContext()` (`template.ts:73-102`) stops deriving `appName`, `bundleId`
and `androidPackage` and takes them as arguments, falling back to today's
derivations when unset.

## Android: three modules

The materialized project grows from one module to three.

```kotlin
// node_modules/.flypath/android/settings.gradle.kts
include(":flypath")
project(":flypath").projectDir = file("<target>/flypath")

include(":native")
project(":native").projectDir = file("<root>/android")

include(":app")
```

`:app` → `:native` → `:flypath`, and `:app` → `:flypath` directly for the
RN-facing pieces `MainApplication` needs.

### `:flypath` — flypath's own Kotlin, as a library

A materialized `com.android.library` module whose `build.gradle.kts` comes
from a new `templates/android/flypath/` and whose sources are the shipped
`node_modules/flypath/android/dev/flypath` via `android.sourceSets` — the
same splat as today, aimed at a dedicated module instead of the app.

Materializing the module rather than shipping a `build.gradle.kts` inside
`node_modules/flypath/android` matters twice: the build script needs
interpolated RN paths it cannot know statically, and a Gradle project
directory inside `node_modules` would grow a `build/` tree there.

All eleven files move as-is; nothing splits. The load-bearing line is the
dependency scope:

```kotlin
dependencies {
  implementation("com.facebook.react:react-android")
  implementation("com.facebook.react:hermes-android")
  api(platform("androidx.compose:compose-bom:2025.06.01"))
  api("androidx.compose.runtime:runtime")
  api("androidx.compose.ui:ui")
}
```

`implementation` for React keeps RN types off the compile classpath of
anything depending on `:flypath`. Plan 5's promise that consumer projects are
React-free stops being convention and becomes a Gradle configuration the
compiler enforces — the guarantee `example/apple` already gets from depending
on the `Flypath` SPM product and nothing else. Compose is `api` because
consumer code writes `@Composable`.

Of the eleven files, three touch `com.facebook`
(`FlypathHermesInstance.kt`, `FlypathScreens.kt`, `FlypathViewManager.kt`;
513 of 821 lines); the other eight are already React-free. Splitting them
into two modules would be tidier and is not worth a second module —
`implementation` scope already produces the property that matters.

### `:native` — the consumer's library

Scaffolded once, then never touched except `src/main/kotlin/generated/`.

```kotlin
// example/android/build.gradle.kts
plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "dev.flypath.example.native"
  compileSdk = 37
  defaultConfig { minSdk = 24 }
  buildFeatures { compose = true }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation(project(":flypath"))
}
```

```xml
<!-- example/android/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
</manifest>
```

An empty manifest is scaffolded deliberately: the point is that there is an
obvious file to type `<uses-permission>` into, and a file that exists is
discoverable in a way a documented convention is not.

The `namespace` is only AGP's R-class and manifest package. Consumer Kotlin
stays in the default package, so generated code keeps calling `printHello()`
unqualified from the same module and plan 5's symbol-name binding is
untouched. The JNI path is likewise unaffected:
`findClassStatic("FlypathGenerated")` (`generate-cpp.ts:156`) is a runtime
classpath lookup, and `implementation(project(":native"))` from `:app` puts
the class there. Which module compiled it is not observable.

### Resources, and the precedence rule

AGP resource merging lets the **app module win** over a library on conflict,
so the split has to be decided rather than discovered:

- **Scalars come from config, into the app module.** `app_name` stays in the
  app template's `strings.xml`, generated from `flypath({ appName })`.
- **Files come from the overlay, in the library.** `styles.xml` (and with it
  `AppTheme` and the Android 12+ splash attributes), `mipmap-*` launcher
  icons including the adaptive `mipmap-anydpi-v26/ic_launcher.xml`, and any
  drawable move to `example/android/src/main/res` and are scaffolded there.
  The app template stops shipping `styles.xml`, so there is nothing to
  collide with; `android:theme="@style/AppTheme"` in the app manifest
  resolves across the module boundary as any library resource does.

This is the whole of the Android identity story. Adaptive icons and the
Android 12 splash screen are `res/` and `themes.xml`, and AGP already merges
those, so flypath writes no code for either.

### `:app` — what shrinks

The app module loses both source-set splats (`__FLYPATH_KOTLIN_SRC_DIRS__`
and `__FLYPATH_ANDROID_DIR__`) and gains two project dependencies.
`kotlinSourceDirs()` (`scaffold.ts:191`) and the interpolation at
`android.ts:170-176` are deleted. `MainApplication` is unchanged —
`FlypathPackage` and `FlypathHermesInstance` are still public types on
`:app`'s compile classpath.

The CMake half is unchanged. C++ stays in the app module: one
`libappmodules.so`, because a library module with its own
`externalNativeBuild` would produce a second `.so` that
`ReactNative-application.cmake` knows nothing about.

### The escape hatch for app-level options

The materialized app `build.gradle.kts` ends with a marker; if
`<root>/android/app.gradle.kts` exists its text is appended verbatim. Gradle's
Kotlin DSL is additive, so a second `android { }` or `dependencies { }` block
at the end of a script configures the same extension:

```kotlin
// example/android/app.gradle.kts
android { defaultConfig { minSdk = 26 } }
dependencies { implementation("com.google.android.gms:play-services-location:21.3.0") }
```

Textual splicing into the app's own script keeps the DSL's generated
accessors working; `apply(from = …)` would not, since an applied script has
no `android { }` accessor and would force
`extensions.configure<ApplicationExtension>`. A `plugins { }` block cannot be
appended (it must come first), so adding a Gradle plugin to the app module is
out of scope — the legacy `apply(plugin = "…")` form works in the fragment.
`<root>/android/gradle.properties`, if present, is merged key-by-key over the
materialized one.

## iOS: the Xcode 16 project format

The code half needs no work — `example/apple` is already a library. The
identity half needs the project template modernized.

### Buildable folders

`templates/ios/App.xcodeproj/project.pbxproj` is on `objectVersion = 56` with
classic groups and one explicit `PBXFileReference` per file — which is why a
user cannot add a resource without flypath generating a pbxproj entry for it.

Bump it to `objectVersion = 77` and make `App/Resources` a
`PBXFileSystemSynchronizedRootGroup` — the buildable folders Xcode 16
introduced, where the project records only the folder path and Xcode builds
whatever is on disk. `runIos` symlinks `<root>/apple/Resources` into the
materialized `App/Resources` (`link.ts` already does exactly this for the
`FlypathCore` sources), and everything the consumer drops in — storyboard,
asset catalog, `.lproj` localizations, fonts — reaches the app target with
zero per-file project generation.

Flypath writes this file, so it picks the format: 77 is the minimum that
supports buildable folders, and local tooling is Xcode 26.3. The compatibility
question is RN's `setup-apple-spm.js`, which mutates the pbxproj in place, but
`spm/spm-pbxproj.js` does targeted regex edits — it matches `PBXGroup` blocks
to clean up after CocoaPods and injects package references — and never parses
the project or touches `objectVersion`. Expected to survive the bump; Phase 3
verifies it rather than assuming.

### Icon and launch screen

`LaunchScreen.storyboard` moves out of the template into the scaffolded
`apple/Resources/`, user-owned from the first build. Alongside it, an
`Assets.xcassets` with a single-size `AppIcon.appiconset` and a placeholder
1024×1024 PNG — iOS auto-generates every other size from one image, so an
icon is a file swap and nothing else. (`template.ts` already treats `.png` as
binary and copies it, `:22`.)

A pleasant property of the buildable folder: an Icon Composer `.icon` file
dropped into `Resources/` is picked up with no flypath change once the
toolchain supports it, since the folder builds whatever is in it.

### The plist SPM cannot write

After `materialize("ios", …)`, `runIos` deep-merges `<root>/apple/Info.plist`
over the materialized `App/Info.plist`: dicts merge recursively, arrays and
scalars replace, the user wins. `NSAppTransportSecurity` becomes tightenable
for release, and `CFBundleURLTypes` finally has a home — closing the
deep-link half of the TODO. The identity scalars (`CFBundleDisplayName`,
`CFBundleShortVersionString`, `CFBundleVersion`,
`UISupportedInterfaceOrientations`) come from `flypath({ … })` through the
existing `__FLYPATH_*__` interpolation into the base plist, and a user key
still overrides them.

`<root>/apple/App.entitlements`, if present, is copied in and
`CODE_SIGN_ENTITLEMENTS` set. Today `CODE_SIGNING_ALLOWED = NO`
(`project.pbxproj:185`, `:208`) means this does nothing observable on the
simulator, so it lands with the "Run on device" TODO — the file is still
scaffolded now so there is one obvious place for it when signing arrives.

`<root>/apple/App.xcconfig`, if present, is passed as `-xcconfig` to
`xcodebuild`. One line, and a sharp tool: a command-line xcconfig applies to
every target in the build, SPM ones included. Documented as such, not
defended against.

## What this unlocks: npm-distributed native libraries

Not built here, but the reason the library shape is worth the work. A
published flypath native package is exactly the structure above:

```
node_modules/@acme/camera/
  package.json      { "flypath": { "native": true } }
  camera.ts         "use native"
  camera.web.ts
  android/          a Gradle library module, manifest and all
  apple/            an SPM package
  cpp/
```

Consuming it becomes: walk `package.json` dependencies for the `flypath` key,
extend the manifest scan into those packages (`manifest.ts` `SKIP`s
`node_modules` today, `:71-79`), add each `android/` as another `include(…)`,
each `apple/` as another `FlypathCore` dependency, each `Info.plist` to the
merge. The permission ships with the library, as it does everywhere else.

Two things block it, both consequences of plan 5's symbol-name binding, and
both worth naming now because they decide whether the current generator
choices are a dead end:

- **Kotlin's default package stops working.** Two flypath native packages
  each emitting a default-package `FlypathGenerated` is a duplicate class on
  one classpath. Generated Kotlin has to move to a per-package namespace
  (`dev.flypath.generated.acme_camera`), dragging the JNI lookup at
  `generate-cpp.ts:156` and the unqualified-call convention with it.
- **Global symbol uniqueness becomes other people's problem.** Plan 5 flags
  this and names per-module namespacing as the recovery path; a third-party
  package colliding with app code is the forcing function, since the app
  author cannot rename someone else's export.

Neither is made worse here. Both get cheaper: once each library owns a
module, "namespace the generated code per module" is a generator change with
an obvious boundary rather than a global rename.

## Phases

### Phase 0 — the Compose plugin across three modules

`org.jetbrains.kotlin.plugin.compose` is applied with an explicit version in
the app module today. Three modules needing it under `android.builtInKotlin`
and RN's `includeBuild` plugin management is the one genuinely unverified
thing here. The expected fix is standard — declare it once in the root
`build.gradle.kts` as `apply false`, apply it version-less below — but plan
5's Phase 0 established that AGP 9 plus built-in Kotlin plus RN is where
surprises live.

Acceptance: a throwaway three-module build with `@Composable` code in each
compiles and installs.

### Phase 1 — `:flypath` as a library module

New `templates/android/flypath/`, the module wired into
`settings.gradle.kts`, the `__FLYPATH_ANDROID_DIR__` splat removed from the
app module, React as `implementation`.

Acceptance: the example builds and runs on Android exactly as before; adding
`import com.facebook.react.bridge.Arguments` to `example/android`'s
`Battery.kt` is a compile error naming the unresolved reference — the
React-free guarantee is now mechanical.

### Phase 2 — the consumer as a library module

Scaffold `<root>/android/build.gradle.kts` and
`<root>/android/src/main/AndroidManifest.xml` once; include the module; `:app`
depends on it; delete `kotlinSourceDirs()` and the
`__FLYPATH_KOTLIN_SRC_DIRS__` interpolation. Move `styles.xml` and the
launcher icon into the consumer's `res/`.

Acceptance: the example runs unchanged; `<uses-permission
android:name="android.permission.CAMERA" />` in the consumer manifest appears
in `apkanalyzer manifest print` output for the built APK; an `androidx.camera`
dependency in the consumer's `build.gradle.kts` resolves and is callable from
Kotlin; a launcher icon in the consumer's `res/` is what the emulator shows;
generated `FlypathGenerated` is still found by `findClassStatic` at runtime.

### Phase 3 — the Xcode format bump and the overlay

`objectVersion = 77`, `App/Resources` as a buildable folder symlinked to
`<root>/apple/Resources`, `LaunchScreen.storyboard` and a placeholder
`Assets.xcassets` scaffolded there, the `Info.plist` deep merge, scaffolded
`App.entitlements`, `-xcconfig` pass-through.

Acceptance: `setup-apple-spm.js` still injects packages into the bumped
project and the app builds; a storyboard edited in `apple/Resources` survives
a rebuild and is what the simulator shows at launch; replacing the
placeholder icon changes the springboard icon; `NSCameraUsageDescription` in
`apple/Info.plist` appears in `plutil -p` on the built `App.app/Info.plist`; a
`CFBundleURLTypes` entry makes `xcrun simctl openurl` reach the existing
`Linking` listener at `native-root.tsx:293-294`, exercising deep links for the
first time; a remote `.package(url:)` dependency added to `example/apple`
resolves and links through the generated `FlypathCore` package.

### Phase 4 — identity through the vite plugin

`FlypathOptions` grows the identity fields; `flypathConfig` exposes them on
`plugin.api`; `runIos`/`runAndroid` resolve the Vite config to read them;
`projectContext()` takes them as arguments; `--port` becomes an override.

Acceptance: `flypath({ bundleId, appName, version, build })` changes the
installed app's identity on both platforms, verified with
`apkanalyzer manifest print` and `plutil -p`; a project passing no options
builds byte-identically to today; `--port 9000` still wins over a configured
port.

### Phase 5 — app-level escape hatches

`<root>/android/app.gradle.kts` appended, `<root>/android/gradle.properties`
merged.

Acceptance: a `minSdk` bump and an extra Maven dependency declared in
`app.gradle.kts` take effect; a `gradle.properties` entry reaches the build;
neither file existing is the common case and costs nothing.

### Phase 6 — the example earns it

`example/app/camera.ts` with a `CameraPreview` `"use native"` component,
Swift and Kotlin implementations, a `camera.web.tsx` using `getUserMedia`,
and the identity options set in `example/vite.config.ts`.

Acceptance: the milestone at the top of this plan, on emulator, simulator and
browser.

## Key decisions

- **The platform's merger does the merging.** Android permissions, resources
  and dependencies go through AGP because AGP already does it correctly for
  every native library that has ever shipped. Flypath writes merge code
  exactly once, for the one case — iOS `Info.plist` — where no merger exists.
- **Scalars in config, files in the overlay.** A bundle id is a value and
  belongs in `vite.config.ts`; a launch screen is a file and belongs on disk
  where a designer can open it. The split also resolves AGP's
  app-beats-library resource precedence by construction rather than by luck.
- **Config lives on the vite plugin, not a new file.** `flypath()` already
  takes options and `vite.config.ts` already exists; a `flypath.config.ts`
  would be a second config file for the same project, and a `package.json`
  key would be untyped.
- **No cross-platform permission abstraction.** `<uses-permission>` and
  `NSCameraUsageDescription` are not one thing in two hats — one is a
  capability grant, the other is prose shown to a human. A `camera: true` key
  needs a mapping table that is wrong the moment a platform ships a key
  nobody anticipated, and it still would not write the sentence.
- **The shell stays disposable.** It holds absolute machine paths and it is a
  function of the native manifest; handing it over means editing the user's
  files on every build. The overlay grows instead. Revisit if app extensions
  or multiple targets are ever in scope — that is where this trade flips.
- **Three Gradle modules, not one.** The extra configuration cost buys the
  React-free guarantee as a dependency scope, better incrementality (consumer
  Kotlin changes stop recompiling `dev.flypath`), and the module boundary an
  npm-distributed library needs anyway.
- **`:flypath` is materialized, not shipped as a Gradle project.** Its build
  script needs interpolated RN paths, and a project in `node_modules` would
  grow a `build/` tree there. Sources stay a plain directory in the package.
- **The Android consumer module is not standalone-buildable.** It depends on
  `project(":flypath")`, which exists only inside the materialized build.
  This matches the status quo — plan 5 gives Android no standalone project —
  and the recovery path, if kotlin-lsp ever becomes usable, is to ship
  `:flypath` as a real project and add a `settings.gradle.kts` beside the
  consumer module.
- **`objectVersion = 77` over per-file pbxproj generation.** A buildable
  folder is one project entry that builds whatever the user puts in it, which
  is the difference between "resources are supported" and "the resources
  flypath thought of are supported".
- **A plist file merge, not `INFOPLIST_KEY_*` build settings.** Xcode's
  `INFOPLIST_KEY_` settings only exist for a fixed Apple-defined subset —
  there is no `INFOPLIST_KEY_CFBundleURLTypes` and no way to express a nested
  dict — so they would cover the easy half and need the file merge anyway.
  One mechanism.
- **C++ stays in the app module.** One `libappmodules.so`, because that is
  the file `ReactNative-application.cmake` builds and RN's SoLoader loads.
- **Scaffolded-once files are scaffolded empty (or placeholder).** An empty
  `AndroidManifest.xml`, an empty `Info.plist`, a placeholder icon — so there
  is an obvious place to type, which a convention in a document is not.

## Risks / open questions

- **Compose plugin across three modules under AGP 9 built-in Kotlin** is
  Phase 0 and the only unknown that could change the shape. The fallback is
  plan 5's ladder: Compose in a separate included build, or
  `android.builtInKotlin=false` with AGP pinned back.
- **`setup-apple-spm.js` against `objectVersion = 77`.** Its pbxproj edits
  are targeted regex, not parsing, so the bump should be invisible to it —
  but it is RN-owned code mutating a file flypath generates, and it is the
  first thing to check in Phase 3. Staying on 56 and generating explicit file
  references per resource is the fallback, at the cost of the property that
  makes the overlay worth having.
- **A symlinked buildable folder** is the specific untested combination:
  `link.ts` symlinks files today and Xcode follows symlinks for file
  references, but a synchronized *directory* that is itself a symlink is not
  something this project has done. Copying instead of symlinking is the
  fallback, at the cost of edits not being live.
- **The scaffolded consumer `build.gradle.kts` can go stale.** It pins
  `compileSdk`, `minSdk` and the Java version and is never rewritten. An AGP
  or compileSdk bump in the shell will eventually need a migration note — the
  price of the file being genuinely user-owned. Keeping the scaffolded
  version minimal is the mitigation.
- **AGP requires the app's `minSdk` to be at least the library's**, so a
  consumer raising `minSdk` in the library module gets a build error telling
  them to raise it in `app.gradle.kts` too. Legible, but two edits for one
  intent — unless `flypath({ android: { minSdk } })` writes both, which is
  the reason that option exists.
- **Resolving the Vite config from the native commands** adds a config load
  (and its transpile) to `flypath ios|android`. Small, but it is new coupling
  between the CLI's native path and the plugin pipeline, and a config that
  throws now breaks a native build that used to be independent of it.
- **The `Info.plist` merge is flypath-authored code with taste in it.**
  Recursive dict merge with array replacement is the obvious rule and will be
  wrong for someone who wants to append to `UIBackgroundModes`. Ship the
  simple rule; revisit with a real case.
- **`-xcconfig` on the command line hits every target**, SPM packages
  included. The standard Xcode escape hatch, and sharp.
- **Build time and configuration cost** of three Gradle modules is
  unmeasured; the incrementality win probably dominates, but "probably" is
  not a measurement.
- **Split-package `dev.flypath`** does not arise here (all eleven files stay
  in `:flypath`), but any future move of the RN-facing three into `:app`
  would create one. Legal on the JVM classpath, and it silently breaks
  `internal` visibility across the boundary.
