# Flypath — styles plan

## Goal

App code styles DOM intrinsics with plain CSS-in-JS objects and those styles
render correctly on web (React DOM) and native (React Native), with shared
design tokens, theming, media queries, pseudo-classes, and animations:

```tsx
// vars.css.ts
import { css } from "flypath";

export const colors = css.vars({
  primary: { default: "red", "@media (prefers-color-scheme: dark)": "pink" },
  secondary: "blue",
});
export const dark = css.override(colors, { primary: "hotpink" });
export const spin = css.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

// my-component.tsx
import { colors, dark, spin } from "./vars.css.ts";

function MyComponent() {
  return (
    <div
      style={{
        display: "flex",
        color: { default: colors.primary, ":hover": colors.secondary },
        padding: { default: 8, "@media (min-width: 600px)": 16 },
      }}
    >
      <div style={[dark, { padding: 16 }]}>
        <span style={{ animation: `${spin} 1s linear infinite` }}>hi</span>
      </div>
    </div>
  );
}
```

Web is the source of truth for semantics; native is a faithful projection,
and both platforms share one set of user-agent defaults so neither looks like
a raw browser nor a raw RN view tree.

This plan covers server components only. Client components (web and native)
are planned separately in PLAN_CLIENT.md.

## What we take from react-strict-dom, and what we don't

RSD's decisions worth copying:

- **Tokens live in specially-named files** (`*.css.ts` here, `*.css.js`
  there) so the compiler has a closed world to extract from.
- **Conditions are value-level maps**: instead of nesting selectors, a
  property's value may be `{ default, ":hover", "@media (...)" }`. This is
  the RSD/StyleX syntax and it drops directly into our inline-object API.
- **Themes are style objects**: `createTheme` returns something you put on
  the `style` prop and it applies to the subtree. `css.override` works the
  same way.
- **Native polyfills the web model, not the reverse**: inherited text styles
  via context, `rem`/`em` via scaling, media queries via `Dimensions` /
  `Appearance`, pseudo-classes via interaction state, web flexbox defaults
  applied on top of Yoga's defaults.
- **A strict property subset**: properties that can't work everywhere are
  compile/render-time errors, not silent divergence.

Where we deliberately diverge:

- **No `css.create`, no StyleX.** RSD's API is StyleX's API; ours is inline
  style objects with the same condition-map values. StyleX would drag Babel
  into the app-code path, breaking the rule that Babel stays quarantined to
  `react-native`/`@react-native/*` internals (Flow strip + preset-react +
  codegen, disk-cached), and its atomic compiler assumes call-site
  `css.create` extraction. We knowingly rebuild the one slice we need — atomic rules for
  conditional values — with a much smaller mechanism (below); unconditional
  styles stay inline and cost nothing.
- **RSD ships styles inside the client bundle; we ship them inside the
  flight payload.** The native style pipeline lives in the server
  (normalization) and in the framework primitives (resolution).
- **RSD has no native keyframe animations; we will** (via an `Animated`
  polyfill driven by serialized keyframes).

## Architecture

### Token model: tokens are branded strings

Everything `css.*` returns is a string (branded at the type level), so tokens
compose with template literals and plain object spreads, and serialize
through flight with zero ceremony:

- `css.vars({ primary: "red" })` returns
  `{ primary: "var(--primary-h4x2, red)" }`. The default value is embedded as
  the CSS-native fallback, so the string is valid on web verbatim and carries
  enough information for native without any registry on the device. A var
  whose value is a condition map still returns the same `var()` string; the
  conditional defaults live in the stylesheet on web and in a server-side
  registry for native normalization.
- `css.keyframes({...})` returns an animation name string `"kf-h4x2"`.
- `css.override(colors, { primary: "hotpink" })` returns
  `{ "--primary-h4x2": "hotpink" }` — a style object of custom-property
  assignments (typed as an opaque `Theme`), usable directly in the `style`
  prop where the CSS cascade scopes it to the subtree.

Hashes are derived from root-relative file path + export/key name: stable
across environments, dev/prod, and HMR updates. Dev names keep a readable
prefix (`--primary-h4x2`), prod can go hash-only.

### Build-time compilation of `*.css.ts` (OXC, no Babel)

A Vite plugin applied in every environment intercepts `*.css.ts` modules:

1. Parse with `oxc-parser` (already a dependency).
2. Statically evaluate `css.vars` / `css.override` / `css.keyframes` calls.
   Supported value forms: literals, condition-map objects, template literals,
   references to local `const` literals, spreads of those. Anything dynamic
   is a build error with a diagnostic pointing at the expression.
3. Rewrite the module (magic-string) into pure data exports — the `css.*`
   calls are gone after compilation. The `css` runtime export exists mainly
   for types; calling it outside a `*.css.ts` file throws with a pointer to
   the naming convention.
4. Emit CSS into the virtual stylesheet: `:root` var declarations (with
   `@media` blocks for conditional var values) and `@keyframes` blocks.
5. In the rsc environment only, the rewritten module additionally registers
   full metadata (conditional var defaults, keyframe frames) in a
   module-scope server registry, so native normalization can inline it into
   the payload.

`css.*` calls in regular `.ts/.tsx` files are rejected at build time, like
RSD's `defineVars`.

### Web pipeline

**Unconditional styles pass through as inline styles.** `style={{ display:
"flex", color: colors.primary }}` reaches React DOM as-is (token already
reads `var(--primary-h4x2, red)`). No runtime style engine.

**Conditional values compile to per-property atomic classes.** In the server
jsx runtime, when a style property's value is a condition map:

- Shorthands are expanded to longhands first (shared with the native
  normalizer), so conflicts are always exact-property and resolved by
  last-wins during array flattening — never by stylesheet rule order.
- The (longhand property, condition map) pair is hashed to a deterministic
  class name, and a self-contained rule set is generated in map order:

  ```css
  .fp-x1 { padding: 8px; }
  @media (min-width: 600px) { .fp-x1 { padding: 16px; } }
  .fp-x2 { color: var(--primary-h4x2, red); }
  .fp-x2:hover { color: var(--secondary-h4x2, blue); }
  ```

  Because each class owns every rule for its property, there is no
  cross-element rule-ordering problem; within a map, later same-specificity
  conditions win, and pseudo-classes outrank media blocks by specificity
  (matching RSD's behavior).
- The element gets the classes appended to `className` and the remaining
  unconditional props as inline `style`. Inline style would beat the class's
  `default`, which is why a property is entirely inline or entirely
  class-based, never both.

**Rule delivery uses React 19 style hoisting.** The jsx runtime wraps the
element in a Fragment that also renders
`<style href={hash} precedence="flypath">` for each generated rule set.
React dedupes by `href` and hoists into `<head>`, and this works uniformly
for SSR streams and later flight-payload updates — no custom injection
machinery. Element creation is memoized per style-object identity so the
extra elements are created once.

**Build-time pre-extraction is the common case, render-time generation the
fallback.** An OXC pass over app code statically extracts condition maps it
can fully resolve (literal values and `*.css.ts` tokens — the overwhelming
majority) into the static stylesheet at build time; those elements carry
only a class name, no hoisted style element, no render-time hashing. The
render-time path above stays as the correctness fallback for maps the pass
can't see through (values computed per request — the point of SDUI). Hashes
are deterministic, so pre-extracted and render-time classes coexist and
never duplicate rules.

**Supported conditions** (v1, matching RSD's set): `:hover`, `:active`,
`:focus`; `@media` with `min-width` / `max-width` / `min-height` /
`max-height`, `prefers-color-scheme`, `prefers-reduced-motion`. One level —
media and pseudo don't nest; nested combinations are a diagnostic and a
future extension.

**`virtual:flypath/styles.css`** aggregates the static parts: the framework
reset (below), `:root` var declarations with their conditional `@media`
blocks, `@keyframes`, and the pre-extracted condition-map rules. In dev it's
a normal Vite CSS module imported by `web-entry` → standard CSS HMR (editing
`vars.css.ts` hot-swaps custom properties without re-rendering React). In
prod it's **one** content-hashed CSS file — Vite's per-chunk CSS splitting
is disabled for this sheet — linked render-blocking from `documentShell`'s
`<head>` via the build manifest, StyleX-style: every build-time rule is
applied before first paint, so no flash of unstyled content and no layout
shift, and atomic dedup keeps the single file small. The only rules outside
it are the render-time-generated ones for per-request dynamic values, and
those can't flash either: React streams inline hoisted `<style>` content
ahead of the markup that references it within the same SSR/flight stream.

**Style arrays** (`style={[theme, {...}]}`) are flattened to one object in
the server jsx runtime before any of the above.

### Shared user-agent defaults ("reset")

One table in framework source, `src/styles/defaults.ts`, is the single source
of truth, consumed twice:

1. **Web**: compiled into the reset portion of `virtual:flypath/styles.css`.
   Base is Josh Comeau's reset verbatim (border-box everywhere, margins
   zeroed except `dialog`, `line-height: 1.5`, media defaults, `font:
   inherit` on form controls, `overflow-wrap`/`text-wrap` tweaks), plus
   alignment additions:
   - `html { font-family: system-ui, sans-serif; }` — matches SF/Roboto on
     native instead of Times New Roman.
   - `:root { color-scheme: light dark; }` — pairs with
     `prefers-color-scheme` conditions in vars.
2. **Native**: the same table provides per-tag base styles for the
   primitives — h1–h6 type scale (matching the browser's em-based scale
   rendered against a 16px root), zero margins (the reset zeroes them on web,
   so native must not re-invent them — the current `h1.tsx` margins go away),
   `lineHeight` 1.5, default `fontSize` 16.

Layout conformance rules applied by native normalization, RSD-style:

- `display: flex` on native gets web defaults layered on Yoga's:
  `flexDirection: "row"`, `alignContent: "stretch"`, `flexShrink: 1`.
- Untyped block containers (`div` without `display`) map to a plain `View`
  (column layout is the closest block approximation; documented divergence).

### Native pipeline

Split across the existing SDUI boundary — heavy lifting on the server, only
context-dependent resolution on the device:

**Server-side normalization** (runs in the rsc environment inside
`resolveIntrinsic`, per element, when the request platform is native):

- Flatten style arrays; merge theme objects into a `$theme` descriptor.
- Expand shorthands (`margin`, `padding`, `border`, `animation`, `inset`,
  `gap`) into longhands — same expansion module the web class generator
  uses.
- Parse value strings once, server-side, so the device never parses CSS:
  `"16px"` → `16`, `"1.5rem"` → `{ $rem: 1.5 }`, `"50%"` stays,
  `var(--x, red)` → `{ $var: "--x", default: "red" }` (conditional var
  defaults from the server registry become nested condition descriptors),
  animation names → `{ $keyframes: [...frames], duration, easing,
  iterations, delay }` looked up from the server keyframes registry.
- Condition maps become structured descriptors with pre-parsed predicates:
  `{ $cond: { default: 8, conditions: [[{ minWidth: 600 }, 16]] } }`,
  pseudo-classes as `[{ hover: true }, value]` — map order preserved.
- Map property names to the strict subset; unknown/web-only properties are a
  dev-time render error naming the element and property (prod: warn + drop).
- Split styles into view-styles vs inheritable text-styles (color,
  fontFamily, fontSize, fontWeight, fontStyle, lineHeight, letterSpacing,
  textAlign) — the latter travel in a separate prop so primitives can
  propagate them.
- Memoize per style-object identity; server components re-create objects per
  render, so also cache by structural hash with a bounded LRU.

**Device-side resolution** (in `components/native/*` primitives, all
`"use client"`, all inside the closed registry):

- `ThemeContext`: maps `--hash` → value. A primitive receiving `$theme`
  pushes a new context merging its overrides; `$var` descriptors resolve as
  `context[$var] ?? default`. This is what keeps `css.override` working
  mid-subtree even though the payload is serialized flat.
- Condition resolution: media predicates match against
  `useWindowDimensions`, `useColorScheme` (`Appearance`), and
  `AccessibilityInfo.isReduceMotionEnabled`; pseudo-classes match against
  interaction state the primitive tracks (`onPressIn/Out` for `:active`,
  `onHoverIn/Out` for `:hover` on pointer-capable devices, `onFocus`/`onBlur`
  for `:focus`). Later entries win within a map; pseudo outranks media
  (mirroring the web specificity outcome). Resolution is a small pure
  function over the descriptor — memoized against the handful of inputs.
- `InheritedTextContext`: RSD-style polyfill for CSS inheritance —
  `div` (View) forwards inheritable text styles down (resolved, not raw
  descriptors); `span`/`p`/headings (Text) consume them under their own
  styles. `em`/`rem` descriptors resolve against inherited font size / root
  font size × `PixelRatio.getFontScale()`.
- Animation driver: a primitive whose style carries `$keyframes` wraps in an
  `Animated.View`/`Animated.Text`, builds one `Animated.Value` timeline, and
  interpolates each animated property between frames. `useNativeDriver` when
  every animated property qualifies (opacity/transform), JS driver otherwise
  (colors, layout). Respects iteration count/infinite, delay, and a mapping
  from CSS easing keywords to `Easing`. Reduced-motion: skip to final frame
  when reduce-motion is enabled.

**Primitive set** grows from `h1` to: `div`, `span`, `p`, `h1`–`h6`
(→ `View`/`Text` with roles), plus `img` → `Image` and `button` →
`Pressable` as the first interactive/asset primitives (`button` doubles as
the `:active`/`:hover`/`:focus` testbed). One generic `createPrimitive(tag)`
factory instead of a file per tag; the registry stays closed.

### Types and `jsxImportSource`

- New `flypath` type surface: `StrictStyles` — the supported CSS property
  subset, where each value is `T | ConditionMap<T>`; `ConditionMap<T>` is
  `{ default: T } & { [K in Condition]?: T }` with `Condition` a union of
  the pseudo-class literals and template-literal types for the supported
  media queries. `style?: StrictStyles | ReadonlyArray<StrictStyles |
  Theme>`.
- Ship a `JSX` namespace from `flypath/jsx-runtime` /
  `flypath/jsx-dev-runtime` types: `IntrinsicElements` based on React's DOM
  attributes but with `style` replaced by the strict type (and, over time,
  the intrinsic set itself narrowed to what native can map).
- `example/tsconfig.json` gains `"jsxImportSource": "flypath"` so LSPs
  type-check the `style` prop against the strict subset. The Vite config
  already compiles with `importSource: "flypath"`; this closes the gap
  between what the compiler does and what the editor shows.
- `css.vars` is generic: `vars<T>(t: T): { [K in keyof T]: VarToken }` so
  `colors.primary` autocompletes.

### HMR

- **Web, `*.css.ts` edit**: virtual stylesheet updates via Vite CSS HMR (no
  React re-render — custom properties repaint); the rewritten JS module also
  hot-updates for anything that captured token strings (token hashes are
  stable, so values-only edits don't invalidate importers). Server component
  edits flow through the existing `rsc:update` path; hoisted conditional
  rules dedupe by `href` so re-renders are idempotent.
- **Native, `*.css.ts` or component edit**: server modules invalidate → push
  `rsc-update` over the existing `/flypath` socket → device refetches the
  payload; new defaults, descriptors, and frames arrive inside it. No native
  bundle rebuild because styles never live in the bundle.

## Out of scope (noted so we don't accidentally design against them)

- Nested conditions (`@media` containing `:hover`), sibling/descendant
  selectors, pseudo-elements (`::placeholder`, `::before`).
- CSS transitions polyfilled on native (animate on prop change) — natural
  follow-up to the keyframes driver, same machinery.
- `calc()`/`clamp()`, grid, `url()` backgrounds — RSD rejects these on
  native too; strict-subset errors for now.
- Everything client-component-related — see PLAN_CLIENT.md.

## Phases

### Phase A — tokens + web inline

1. `*.css.ts` compiler plugin (oxc-parser static eval, magic-string
   rewrite), `css.vars` with scalar and condition-map values; deterministic
   hashing; build error diagnostics for dynamic values and for `css.*`
   outside `*.css.ts`.
2. `virtual:flypath/styles.css`: reset + vars (+ conditional var `@media`
   blocks); dev CSS HMR; prod extraction linked from `documentShell`.
3. Strict style types, `JSX` namespace, example tsconfig
   `jsxImportSource: "flypath"`; style array flattening in the server jsx
   runtime.
4. Acceptance: example uses `colors.primary` in a server component on web;
   token edit hot-swaps color without re-render; a
   `prefers-color-scheme`-conditional var flips with the OS theme; misuse of
   `css.vars` in a non-`.css.ts` file fails the build with a useful message.

### Phase B — conditional styles on web

1. Shared shorthand-expansion module; condition-map detection in the server
   jsx runtime; atomic class hashing + rule-set generation; `className`
   merge + inline/class split.
2. Rule delivery via React 19 `<style href precedence>` hoisting; element
   memoization.
3. Build-time OXC pre-extraction pass for statically resolvable condition
   maps into the static stylesheet.
4. Acceptance: hover and viewport-width conditions work on the example
   server-rendered page; SSR HTML contains the hoisted rules (no flash);
   an `rsc:update` carrying a new condition map applies without duplicated
   style tags; a literal condition map produces zero render-time hashing
   (rule present in the static stylesheet, verified by build output).

### Phase C — native styles

1. Server-side normalization in `resolveIntrinsic`: shorthand expansion,
   value parsing to descriptors, condition descriptors, strict-subset
   validation, view/text style split, flex-conformance defaults,
   memoization.
2. `createPrimitive` factory; primitives for `div`, `span`, `p`, `h1`–`h6`,
   `button`, `img`; `InheritedTextContext`; UA-defaults table shared with
   the reset; delete the hand-written `h1.tsx` margins.
3. Device-side condition resolution (dimensions, color scheme,
   reduce-motion, press/hover/focus state).
4. Acceptance: the same styled server component renders equivalently on web
   and both simulators (color, spacing, type scale); rotating the simulator
   flips a `min-width` condition; pressing a `button` applies `:active`
   styles; unsupported property surfaces a symbolicated dev error on device
   via LogBox.

### Phase D — theming (`css.override` + `ThemeContext`)

1. Compiler support; `Theme` type; theme objects through style arrays on
   web (inline custom properties) and `$theme` descriptors on native
   (context push); `$var` resolution with embedded defaults on device.
2. Acceptance: nested overrides resolve correctly on all three platforms,
   including overriding a var whose default is condition-mapped; editing an
   override hot-applies.

### Phase E — animations

1. `css.keyframes` compilation → `@keyframes` on web + rsc-side frames
   registry; `animation` shorthand expansion in normalization; frames
   inlined into the payload.
2. Native `Animated` driver in primitives: timeline value, per-property
   interpolation, native driver when eligible, easing map, iteration/delay,
   reduced-motion.
3. Acceptance: `spin` runs on all three platforms; an opacity+transform
   animation uses the native driver (verify no per-frame bridge traffic);
   editing keyframes hot-updates web via CSS HMR and native via payload
   refetch.

## Risks / open questions

- **Static evaluation ergonomics**: literal-only `*.css.ts` will pinch
  (computed scales, shared constants). Escape hatch if needed later:
  evaluate `*.css.ts` through the rsc environment's module runner instead of
  statically — the token/CSS emission contract stays identical, only the
  evaluator changes.
- **Hoisted-rule accumulation**: React's precedence-hoisted styles are never
  removed, so many distinct condition-map values over a long session
  accumulate rules. Bounded for server-rendered pages; revisit (CSS var
  indirection or build-time extraction) if it grows.
- **Prod CSS linking through plugin-rsc**: getting the extracted stylesheet
  URL into `documentShell` depends on plugin-rsc's manifest behavior for
  framework-owned virtual CSS; may need to read its source (same risk
  already flagged in PLAN.md).
- **Normalization cache**: structural hashing of style objects per element
  per request must stay cheaper than the work it saves; measure with a
  many-element payload before committing to the LRU.
- **Payload growth**: var references carry defaults, condition maps carry
  every branch, animated elements carry frames. If payloads bloat, add a
  payload-level dedupe (single defaults map serialized once per response) —
  design keeps this possible since descriptors are plain data.
- **Inline elements are blocks on native.** `span` is a `Text` in a column
  flex container, so it stretches to the container width instead of
  shrink-wrapping like an inline box. It is invisible for plain text, but a
  `transform` on a `span` rotates about the centre of a full-width box rather
  than the glyphs. Nested inline text (`strong`/`em`/`code` inside a `p`)
  composes correctly, since RN nests `Text` the way the DOM nests inlines.
- **`:hover` on touch devices**: RN emits hover only for pointer devices;
  web touch browsers emulate sticky hover. Document divergence; don't
  emulate stickiness on native.
- **Animated fidelity**: CSS timing functions and multi-property keyframes
  with different per-property presence don't map 1:1 to `Animated`
  interpolations; scope v1 to per-property linear/cubic-bezier-keyword
  easing and document divergence.
- **Type-narrowing `IntrinsicElements`**: replacing React's JSX types
  wholesale may fight `@types/react` in mixed files (framework internals use
  react-native's JSX). Keep framework `src` on React's jsx types; only app
  code adopts `jsxImportSource: "flypath"`.

## References

- https://facebook.github.io/react-strict-dom/ (API + property support
  matrix; condition-map syntax, polyfilled media queries/pseudo-classes on
  native; animations unsupported on native there)
- https://stylexjs.com/ (compiler/theming prior art; not adopted)
- https://www.joshwcomeau.com/css/custom-css-reset/ (reset base)

## Deviation from this plan (as implemented)

Everything above is implemented except where noted here.

### API and packaging

- `flypath`'s root export (`.`) is now the app-facing surface: `css` plus the
  style/token types. The Vite plugin re-export was removed from it (it lives
  only at `flypath/vite`) so importing `css` in app code does not drag Vite
  into the module graph.
- `css.vars` fallbacks are serialized verbatim (`String(value)`), so a numeric
  var value produces `var(--x, 8)`, not `var(--x, 8px)`. Length-valued vars
  must carry units in the token definition.
- `css.override` values are restricted to scalars. Overriding a var with a
  condition map is a build error; the plan's Phase D acceptance for
  "overriding a var whose default is condition-mapped" holds only in the other
  direction (the *base* var may be condition-mapped, and the override replaces
  it wholesale).
- `css.vars` conditions are restricted to `@media`; pseudo-classes are
  rejected, since `:root:hover` is not the semantics anyone wants.

### Web pipeline

- **Unconditional styles are expanded to longhands too**, not just conditional
  ones. The plan expanded shorthands only for conditional values, but inline
  style always beats a class in the cascade, so an unconditional `margin: 8`
  left as a shorthand would override a later class-based `marginTop`. Both
  sides now normalize to longhands and last-wins resolves everything before
  the inline/class split.
- **Pre-extraction markers carry the original condition map.** The build-time
  pass rewrites a resolvable condition map to `{ $c: {longhand: class}, $v:
  <original map> }` rather than a bare class reference. The rsc environment
  serves both web and native from the same rewritten module, so native needs
  `$v` to build its descriptors; web uses `$c` and ignores `$v`.
- **Pre-extraction runs only in the rsc environment**, so client components
  (PLAN_CLIENT) never see the markers.
- **Stylesheet delivery is `import.meta.viteRsc.loadCss()`**, not a manifest
  read in `documentShell`. `server-entry` imports `virtual:flypath/styles.css`
  and renders `loadCss()` in `<head>`; plugin-rsc emits a render-blocking
  `<link>` in both dev and prod from one content-hashed file. `web-entry` does
  not import the sheet — dev HMR works by invalidating the virtual module and
  pushing a `css-update` for its URL, which swaps the `<link href>`. This
  removes the "prod CSS linking through plugin-rsc" risk entirely.

### Native pipeline

- `createPrimitive` lives in a non-`"use client"` module; the client boundary
  is `components/native/elements.tsx`, which calls the factory once per tag and
  exports the results as named client references. The native stub used for the
  web client build now generates matching named exports from `TAG_DEFAULTS`.
- **The intrinsic set is wider than the plan's `div`/`span`/`p`/`h1`–`h6`/
  `button`/`img`.** Every tag whose behaviour is purely presentational costs a
  row in `TAG_DEFAULTS`, so the set also covers `article`, `section`, `aside`,
  `header`, `footer`, `main`, `nav`, `figure`, `figcaption`, `blockquote`,
  `strong`, `b`, `em`, `i`, `small`, `code`, `pre`, and `label`. `TAGS` in
  `styles/defaults.ts` is the single source: the `Tag` union drives
  `IntrinsicElements`, `nativeIntrinsics` is typed `Record<Tag, unknown>` so a
  missing registration is a compile error, and the web client stub generates
  its exports from the same table. Interactive tags (`input`, `textarea`,
  `select`, `form`, `a`) need state and handlers, so they moved to
  PLAN_CLIENT.md; `ul`/`ol`/`li` and `table` have no native equivalent.
- Generic font families are mapped on device (`monospace` → `Menlo` on iOS,
  `monospace` on Android; `system-ui`/`sans-serif` → RN's default), which is
  what makes `code` and `pre` render correctly.
- Unitless `lineHeight` parses to an `{ $em }` descriptor (CSS treats it as a
  font-size multiple); `fontWeight` numbers are stringified for RN.
- `transformOrigin` and `verticalAlign` are in the strict subset for web but
  flagged web-only, so they are a dev-time error on native.
- `:hover` is wired through `onPointerEnter`/`onPointerLeave` on View/Text and
  `onHoverIn`/`onHoverOut` on `button`'s `Pressable`; handlers are attached
  only when the element's descriptors actually contain a pseudo condition (or
  the tag is `button`).

### Phase E needed a Hermes runtime flag

`css.keyframes` compiles, `@keyframes` lands in the stylesheet, the animation
shorthand expands, frames are inlined into the native payload, and the
`Animated` driver in `components/native/animation.ts` works as specified.

Getting it to run on native took a fix outside the style pipeline. Hermes does
not enable ES6 per-iteration bindings for `let`/`const` in loops by default —
it is gated behind `ES6BlockScoping`, off in `RuntimeConfig`. React Native's
`NativeAnimatedHelper.createNativeOperations()` builds its operation table with
exactly that pattern, so every entry bound to the last method name
(`removeListener`, which the TurboModule spec does not have) and
`API.createAnimatedNode(...)` called an undefined function. Any use of
`Animated` hit it, with `useNativeDriver` both true and false.

Confirmed against the same Hermes build the app links (`hermesvm` Catalyst
slice, `withES6BlockScoping` toggled around one `evaluateJavaScript`):

```
ES6BlockScoping=false: v2:3,v2:3,v2:3
ES6BlockScoping=true : v0:0,v1:1,v2:2
```

The fix is `native/FlypathHermesRuntime.h`, shipped by the package: a
platform-neutral `JSRuntimeFactory` that mirrors RN's
`HermesInstance::createJSRuntime` plus `.withES6BlockScoping(true)`. It is
included by a thin `templates/ios/App/FlypathHermes.mm` and returned from
`AppDelegate`'s override of `createJSRuntimeFactory` — RN's own public override
point, so no patching of `react-native` and no Babel pass over the native
module graph. `runIos` copies the header next to the template sources, so
there are no header search paths to configure, and the Android JNI shim will
include the same file rather than restating it (`__has_include` picks the right
`HermesRuntimeTargetDelegate` path per platform).

The alternative considered and rejected was lowering block scoping with
`@babel/plugin-transform-block-scoping` over every native module, the way
Metro does. It works, but it rewrites `const` to `var` in the markers the
native bundler string-matches (`__cjs_to_esm_hoist_`,
`__cjs_module_runner_transform`, `__vite_ssr_import_N__`), so three separate
bundler regexes had to be loosened to keep the lazy-require layer working —
a standing fragility for any future marker. The runtime flag costs nothing per
module and gives real ES6 semantics instead of a lowering.

**Android still needs the same flag.** `getDefaultReactHost(context,
reactNativeHost, jsRuntimeFactory)` is the matching Kotlin seam, but
`JSRuntimeFactory` is a `HybridData`-backed C++ object, so the Android template
needs a small JNI/CMake module — which means adding an NDK build to a template
that currently has none. Until that lands, native animations work on iOS only.

### Verified

- Web dev and prod: tokens, `prefers-color-scheme` var branch, hover and
  `min-width` conditions, theme override, pre-extraction (classes in the static
  sheet, no render-time `<style>`), render-time fallback for per-request values
  (hoisted `<style>` ahead of the markup), `css` outside `*.css.ts` failing the
  build with the file named, `vars.css.ts` edit hot-swapping the custom
  property without re-render, one content-hashed CSS file linked
  render-blocking from `<head>` in the production build.
- Types: `example` type-checks with `jsxImportSource: "flypath"`; unknown
  property, unmapped intrinsic, and a condition map missing `default` are all
  compile errors.
- iOS simulator: h1/h2 type scale, zeroed UA margins, inherited text styles,
  `var()` resolution, `css.override` scoped through `ThemeContext`, button
  padding/radius/background — all matching web.
- iOS simulator: the full presentational tag set renders, including nested
  inline text (`strong`/`em`/`code`/`small` inside a `p`) inheriting correctly
  and `code` resolving to a real monospace face.
- iOS simulator: the `spin` keyframe animation runs, driven by `Animated` with
  the native driver, once the Hermes flag is in place.
- Android and the `:active`/rotation acceptance checks were not run.
