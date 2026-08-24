# Flypath — RSC Server Actions plan

## Goal

`"use server"` functions work end-to-end on web, iOS and Android:

```tsx
// app/actions.ts
"use server";

let entries: string[] = [];

export async function sign(prev: string | null, formData: FormData) {
  const name = String(formData.get("name") ?? "");
  if (name === "") return "name required";
  entries = [...entries, name];
  return null;
}
```

```tsx
// app/index.tsx (server component)
<form action={sign.bind(null, null)}>
  <input name="name" placeholder="your name" />
  <button type="submit">sign</button>
</form>
```

```tsx
// app/guestbook.tsx (client component)
"use client";
import { useActionState } from "react";
import { sign } from "./actions.ts";

export default function Guestbook() {
  const [error, action, pending] = useActionState(sign, null);
  return (
    <form action={action}>
      <input name="name" />
      <button disabled={pending} type="submit">sign</button>
      {error && <p>{error}</p>}
    </form>
  );
}
```

All four invocation shapes work on all three platforms:

1. `<form action={fn}>` in a **server component** (action arrives through the
   flight payload as a server reference),
2. `<form action={fn}>` / `useActionState` in a **client component** (action
   arrives through a `"use server"` module import),
3. programmatic calls (`onClick={() => fn(x)}`) from client components,
4. progressive enhancement on web: the form posts and works before hydration
   (and with JS disabled), with `useActionState` state carried through
   `formState`.

After every action the server re-renders and streams a fresh root alongside
the return value, so mutations and their resulting UI arrive atomically.

## SDUI framing

Actions are the mutation half of SDUI, and they strengthen the guarantee
rather than bending it:

- The device only ever holds **opaque reference IDs**. Action code never
  leaves the server; there is nothing to ship, cache, or version on the
  client.
- The callable set is **closed by the server manifest**: `loadServerAction`
  rejects any ID the rsc build didn't register, so a payload (or attacker)
  cannot conjure new server behavior.
- The response to an action is a **new platform-correct root** rendered under
  the same `runWithPlatform` scope, so the UI update after a mutation is as
  server-owned as the initial render — the client swaps payloads, it never
  computes UI.
- Enforcement on the device stays where PLAN_CLIENT.md put it: the flight
  client and chunk loader only talk to the configured server origin; the
  action callback is one more consumer of that same origin.

## Payload restructure + `rsc-html-stream` (yes, adopt it)

Today the flight payload is a bare `ReactNode` and the browser boots by
fetching `?__flight=1` — a second, separate render of the same route. Actions
force a payload envelope anyway (`returnValue`, `formState` have to travel
with the root), so restructure once, for every platform:

```ts
type RscPayload = {
  root: ReactNode;
  returnValue?: unknown;
  formState?: unknown;
};
```

Inline the flight stream into the SSR HTML with `rsc-html-stream` (new
dependency, ~1KB, the same mechanism plugin-rsc's starter uses): `ssr-entry`
tees the rsc stream, renders HTML from one half, pipes the other through
`injectRSCPayload`; `web-entry` reads `rscStream` from
`rsc-html-stream/client` instead of fetching.

This is genuinely useful beyond taste:

- **Kills the double render.** One rsc render per page load instead of two
  (SSR pass + `__flight` fetch), and hydration is guaranteed to match the
  HTML because both come from the same stream.
- **Required for `formState`.** Progressive enhancement hydrates
  `useActionState` via `hydrateRoot(document, root, { formState })`, and the
  `formState` must be the one the HTML was rendered with — only the inlined
  stream gives that.
- **Cuts code.** `web-entry` loses its boot-time `fetchFlight`; the
  `__flight` query param survives only for HMR refetch and post-action
  navigation (later: real navigation).

Native is untouched by the inlining (there is no HTML), but adopts the same
`RscPayload` envelope, so both flight clients decode one shape.

## Server track (`server-entry.tsx`)

`handler` grows a POST branch, still inside `runWithPlatform` (the
`x-flypath-platform` header / `platform` param applies to action requests
too — this is what makes the post-action root platform-correct):

1. **Client-invoked actions** (`x-rsc-action` header present — sent by web
   and native callbacks alike):
   - body is `await request.formData()` when content-type is
     `multipart/form-data`, else `await request.text()`,
   - `temporaryReferences = createTemporaryReferenceSet()`,
   - `args = await decodeReply(body, { temporaryReferences })`,
   - `action = await loadServerAction(id)`,
   - `returnValue = await action.apply(null, args)`.
2. **Progressive enhancement** (POST without the header — a real form post
   from un-hydrated web):
   - `formData = await request.formData()`,
   - `action = await decodeAction(formData)`,
   - `result = await action()`,
   - `formState = await decodeFormState(result, formData)`.
3. Either way, re-render the route and stream
   `renderToReadableStream<RscPayload>({ root, returnValue, formState },
   { temporaryReferences })`. For case 2 the response continues into the SSR
   path and returns HTML, so no-JS round-trips land on a fully rendered page.

Action throws propagate through the flight stream and surface in the
client's ErrorBoundary (web and native); dedicated error/redirect semantics
wait for routing.

Inline `"use server"` closures in server components work without extra
effort — plugin-rsc registers them in the rsc environment and encrypts bound
args (`encryptActionBoundArgs`) transparently.

## Web track

1. **`web-entry.tsx` restructure** (starter shape): a `Root` component holds
   `payload` in state; module-level `setPayload` swaps it.
   - initial payload: `createFromReadableStream<RscPayload>(rscStream)` from
     `rsc-html-stream/client`,
   - `hydrateRoot(document, <Root />, { formState: initial.formState })`,
   - `setServerCallback(async (id, args) => { ... })`: `encodeReply(args,
     { temporaryReferences })`, POST to the current URL with `x-rsc-action:
     id`, decode the `RscPayload` with the same temporary reference set,
     `startTransition(() => setPayload(payload))`, return
     `payload.returnValue`,
   - the existing `rsc:update` HMR listener refetches `?__flight=1` and calls
     `setPayload` — same channel, less special-casing than today.
2. **`<form>` on web needs no primitive work**: `createIntrinsic` passes
   `action` through and React DOM implements the whole protocol (submit
   interception, FormData construction, `useFormStatus`, post-action reset,
   `$ACTION_ID` hidden fields for the no-JS path via the SSR
   `encodeFormAction` wiring plugin-rsc installs).
3. Verify plugin-rsc discovers `"use server"` files imported from client
   modules under `example/app/**` and that editing an action file triggers
   `rsc:update` without a full browser reload (dev reference IDs are
   URL-stable, so proxies in client bundles stay valid).

## Native track

### Flight client + callback

- `native-entry` installs the same `setServerCallback` shape as web, POSTing
  to `${serverUrl}/?platform=${platform}` with both `x-rsc-action` and
  `x-flypath-platform` headers. `createFromFetch`/`createFromReadableStream`
  from `@vitejs/plugin-rsc/react/browser` already thread `callServer`, so
  server references inside payloads (case 1 in the goal) become callable the
  moment the callback exists.
- `native-root` decodes `RscPayload`, renders `payload.root`, and exposes
  its `setPayload` to the callback so post-action roots swap in-place (the
  `/flypath` rsc-update path and the action path converge on the same state
  setter).

### `"use server"` imports in chunks

plugin-rsc's `rsc:use-server` transform runs in every non-rsc environment
and already rewrites `"use server"` modules into `createServerReference`
proxies — including our `native_ios`/`native_android` environments. Two
fixes make it correct for native:

- For non-`client` environments it injects an import of
  `@vitejs/plugin-rsc/react/ssr`, whose `callServer` is hardwired `null`.
  `nativeResolve` aliases that specifier to
  `@vitejs/plugin-rsc/react/browser` in the native environments, so chunk
  proxies share the global callback the entry installed. (Fallback if the
  transform turns out to be env-gated somewhere: run
  `transformDirectiveProxyExport` from `@vitejs/plugin-rsc/transforms`
  ourselves in the bundler with the same dev reference keys.)
- `findSourceMapURL` in the proxy uses `import.meta.url`; verify it degrades
  gracefully in the CJS-wrapped chunk output (it is a DevTools nicety —
  stub it in the native env if it throws).

This preserves the SDUI boundary mechanically: a `"use server"` module that
reaches the native bundler contributes only reference strings to the chunk,
never its body. Add a bundler assertion that no module carrying the
directive is ever emitted un-proxied.

### FormData + multipart on Hermes

`encodeReply` returns a string for plain JSON-ish args but switches to
`FormData` whenever the args include one (every form submission). RN's
built-in `FormData` is not spec-complete and its fetch integration targets
RN networking's native multipart path, which react-native-fetch-api's
streaming fetch does not use. So `flight-native.ts` grows:

- a small spec-compliant `FormData` polyfill (string entries only — file
  parts wait for a file-input story) installed globally, used both by
  `encodeReply` and by the form primitive,
- multipart serialization in the fetch wrapper: when `body instanceof`
  our `FormData`, serialize entries to a boundary-delimited string and set
  the `content-type` header, so undici's `request.formData()` parses it on
  the server.

### Form primitive redesign (`primitive.tsx` + `context.ts`)

The current `FormControl = { submit }` model only relays a synthetic event
to `onSubmit`. Actions need the form to *own field state*, so `FormContext`
becomes a registry:

```ts
type FormControl = {
  register(name: string, read: () => string): () => void;
  submit(overrideAction?: unknown): void;
  pending: boolean;
};
```

- **Field registration**: `input`/`textarea` primitives with a `name` prop
  register a reader — controlled fields read `props.value`, uncontrolled
  fields read a ref the primitive keeps current from `onChange`. (This ref
  also fixes today's gap where an uncontrolled TextInput's value is
  unobservable at submit time.)
- **Submit semantics mirror React DOM**: `submit()` fires `onSubmit` first
  with a synthetic event whose `preventDefault` actually latches; if not
  prevented and the form's `action` prop (or a button's `formAction`
  override) is a function, build a `FormData` from the registry and invoke
  `action(formData)` inside a transition. Existing pure-client forms
  (`onSubmit` + `preventDefault`) keep working unchanged.
- **Pending state**: the form primitive wraps the action call in
  `useTransition` and publishes `pending` through the context.
- **Triggers**: `button type="submit"` and `input` `onSubmitEditing` already
  call `form.submit()`; extend the button path to pass its `formAction` when
  set.
- **Post-action reset**: after an action resolves (not throws), reset
  uncontrolled registered fields, matching React DOM's behavior. TextInput
  needs an imperative clear — route it through the registration handle.
- Strict-subset rule stays: `event.currentTarget` on native is not a DOM
  form (no `new FormData(event.currentTarget)`); dev-warn and point at the
  `action` prop.

### `useFormStatus`

Web client components get it from `react-dom`; native has no react-dom. Add
a `useFormStatus` export to flypath resolved per platform condition like the
jsx runtimes: default flavor re-exports react-dom's, react-native flavor
reads `FormContext.pending`. Client components import it from `flypath` and
work everywhere.

## Example

Extend the example app to exercise every shape:

- `app/actions.ts` with a module-scoped guestbook,
- a plain `<form action={...}>` + entry list in the server component,
- `app/guestbook.tsx` client component with `useActionState` +
  `useFormStatus`-driven disabled state,
- keep the existing client-only form in `counter.tsx` untouched (regression
  canary for the non-action path).

## HMR + dev-tools

- Editing `app/actions.ts`: it is an rsc-env module without `"use client"`,
  so the existing watcher pushes `rsc-update` to web and native; dev
  reference IDs are path-derived, so live proxies in browser bundles and
  native chunks stay valid and the next invocation runs the new body. Verify
  the client-environment proxy module doesn't trigger a full browser reload.
- Action POSTs are ordinary fetches: visible in React Native DevTools'
  network panel and the browser's; nothing new to teach `/symbolicate`,
  LogBox, or the sockets.
- An action thrown error must land in LogBox with symbolicated frames on
  native (server frames arrive as flight error metadata — verify the
  message survives; source-mapped server stacks are a later nicety).

## Production

Deferred with the rest of the release story (PLAN_CLIENT.md Phase 5), but
the shape is fixed now:

- build-mode reference keys are hashes; the native chunk build must run the
  same use-server transform under build config so keys match the rsc
  build's server manifest,
- the manifest stays closed: only actions reachable from the app graph are
  invokable,
- `rsc-html-stream` inlining works identically in prod SSR (it is how the
  starter ships).

## Phases

### Phase 1 — payload envelope + inline stream (web)

`RscPayload` type; `server-entry` renders the envelope; `ssr-entry` injects
via `rsc-html-stream/server`; `web-entry` Root/`setPayload` restructure
reading `rsc-html-stream/client`; HMR refetch through the same path.
Acceptance: web renders and hydrates with zero `__flight` fetch on boot;
HMR still live-updates; native still renders (envelope decoded).

### Phase 2 — actions on web

POST branch in `server-entry` (both header and no-JS paths);
`setServerCallback` + temporary references in `web-entry`; example actions.
Acceptance: server-component form and `useActionState` client form both
mutate and re-render; with JS disabled the form still works and, after
hydration on a fresh load, `formState` shows the last result; editing
`actions.ts` hot-applies.

### Phase 3 — actions on native

Server callback + `RscPayload` in `native-root`/`native-entry`; react/ssr →
react/browser alias; FormData polyfill + multipart fetch; form primitive
registry/submit/pending redesign; `useFormStatus`.
Acceptance: both example forms work on iOS and Android simulators — submit
from the keyboard and the button, pending disables, post-action UI reflects
the mutation without reload; a payload-delivered action prop and a
chunk-imported action both round-trip; unknown action ID is a hard server
error surfaced in the ErrorBoundary.

### Phase 4 — polish

Post-action uncontrolled reset; `formAction` overrides; dev warnings for
the strict-subset edges (`event.currentTarget`, unsupported input types in
forms); LogBox verification for action throws.
Acceptance: React DOM and the native primitive agree on observable submit
semantics for every example form; documented subset errors fire in dev.

## Risks / open questions

- **Multipart fidelity.** Hand-rolled multipart serialization against
  undici's parser (boundary quoting, UTF-8 field names) is the riskiest
  novelty; test it directly with a unit round-trip
  (`encodeReply` → serializer → `Request.formData()` → `decodeReply`)
  before touching a device.
- **`rsc:use-server` in custom environments.** Relying on plugin-rsc's
  transform firing in `native_*` deepens the internals coupling flagged in
  every prior plan; the `transformDirectiveProxyExport` fallback keeps us
  one import away from owning it.
- **Temporary references on Hermes.** The temporary-reference protocol is
  exercised far less off-browser; if it misbehaves under the polyfilled
  streams, v1 can ship without it (plain-JSON args only) since form
  submissions don't need it.
- **`useActionState` without react-dom.** The hook lives in `react` and the
  primitive invokes the wrapped dispatch directly, which should be
  renderer-agnostic — but the React DOM form-reset/`formState` integration
  points are DOM-tuned; native intentionally reimplements only the
  observable parts, and divergences get triaged against "what would React
  DOM do".
- **Errors and redirects.** Action-thrown control flow (redirect/not-found)
  has no home until routing exists; v1 treats every throw as an error
  boundary hit. Revisit in the routing plan.
- **Concurrent actions.** Two in-flight actions race on `setPayload`;
  last-write-wins matches the starter, but note it — a queue or abort story
  can ride on navigation work later.
