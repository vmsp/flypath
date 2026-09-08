# Flypath — email

## Goal

Let an app send mail written with the components it already has. The same
`div`, `p`, `img` and `style` prop that render a page render an inbox, and
one call sends it.

```tsx
// app/mail.tsx
import { href, Preview, Subject } from "flypath";

import { colors } from "./vars.css.ts";

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <div style={{ padding: 24 }}>
      <Subject>Welcome to Flypath!</Subject>
      <Preview>Your account is ready.</Preview>
      <meta content="Flypath" name="author" />
      <img alt="Flypath" src="cid:logo" style={{ width: 96 }} />
      <h1 style={{ color: colors.text }}>Welcome, {name}!</h1>
      <p
        style={{
          color: {
            default: "#111",
            "@media (prefers-color-scheme: dark)": "#eee",
          },
        }}
      >
        Glad you are here.
      </p>
      <a href={href("/settings")}>Finish your profile</a>
    </div>
  );
}
```

```ts
import { sendMail } from "flypath";

await sendMail({
  to: "someone@example.com",
  content: <WelcomeEmail name="Someone" />,
  attachments: [{ cid: "logo", content: logoBytes, filename: "logo.png" }],
});
```

`SMTP_URL` in `.env` says where it goes, exactly like `DATABASE_URL`.

The rendering pipeline is the one already in the repo: the RSC renderer
runs the components (so an email may be an `async` server component that
queries the database), the SSR environment turns the flight payload into
HTML, and a third style target — beside `styles/web.ts` and
`styles/native.ts` — turns the same flattened style into what an inbox
understands: every unconditional declaration inlined on the element, and
only what cannot be inlined (`@media`, `:hover`) left in one `<style>` in
`<head>`, marked `!important` so it still beats the inline value.

Milestone: `postNote` in `example/app/actions.ts` enqueues a job that
renders `MentionEmail` — an `async` server component that queries the
database and imports `vars.css.ts` — and sends it; Mailpit receives a
message whose `Subject` is the text of `<Subject>`, with a `text/plain`
alternative derived from the HTML, a single `<style>` in `<head>` holding
nothing but the dark-mode rule, every other declaration inline, every
`var(--…)` resolved to a literal, the logo delivered as a `cid:` part in
`multipart/related`, and Mailpit's `html-check` reporting no new
unsupported feature; importing the same component from a page renders the
same pixels in the browser.

## What is missing today

**There is nothing.** `TODO` has one line — "Email —
https://github.com/react/react/tree/main/packages/react-reconciler" — and
that is the whole of it. No transport, no MIME, no renderer, no
`SMTP_URL`.

**But almost every piece already exists, pointed at a different target.**

- `flattenStyle()` (`styles/flatten.ts:87`) already turns the `style` prop
  — objects, arrays, shorthands, condition maps, build-time `$c`/`$v`
  markers, `--var` theme entries — into one `Map<longhand, value>`. It has
  two consumers, `webStyle()` (`styles/web.ts:66`) and `nativeStyle()`
  (`styles/native.ts:280`). Email is a third, and the smallest of the
  three.
- `atomicRule()` (`styles/atomic.ts:22`) already emits
  `.fp-hash { … }`, `.fp-hash:hover { … }` and
  `@media … { .fp-hash { … } }` from a condition map. Email needs the same
  strings with `!important` and without the `default` branch.
- `createIntrinsic()` (`runtime/element.ts:32`) already emits
  `<style href={className} precedence="flypath">` next to the element it
  belongs to and lets React 19 hoist, order and dedupe them. Rendered
  inside a document, React merges all of them into **one** `<style>` in
  `<head>` — which is exactly the shape an email wants, for free.
- `nativeStyle()` already resolves `var(--x, fallback)` against the
  registry (`styles/native.ts:57`) — including the case where the token
  is a condition map, which is how `css.vars({ text: { default: …,
"@media (prefers-color-scheme: dark)": … } })` becomes a real dark mode.
  Email needs the same resolution because no `var()` survives Gmail or
  classic Outlook.
- `TAG_DEFAULTS` (`styles/defaults.ts:79`) already encodes what a browser
  does to an untouched `h1`, `p` or `a`. Native inlines them because it
  has no user-agent stylesheet. Neither does an inbox.
- The two-pass render — `toFlight()` then
  `import.meta.viteRsc.loadModule("ssr", "index")`
  (`runtime/server-entry.tsx:182`, `:367`) — is the only way to run a
  server component and get HTML, and it already works in dev, in the
  production bundle and inside `flypath work`.
- `databaseOptions()` / `connectionUrl()` (`db/config.ts`) are the pattern
  for "declared in `vite.config.ts`, defaulted from `.env`, with a good
  error when neither is set".
- `jobs()` already exists, so "send this later, retry it, don't block the
  response" is solved; email does not need its own queue.

**Three small gaps in the existing surface.** `<meta>` is not in
`JSX.IntrinsicElements` (`runtime/jsx.ts:12` allows the `Tag` union plus
`title` only), so the `<meta>` in the sketch above is a type error today;
`isMetadata()` (`runtime/intrinsics.ts:3`) knows only `title`, so `<meta>`
would also throw on native; and `collect()`/`replay()` are private to
`server-entry.tsx`.

## Field notes — prior art

- **react-email**. React components → HTML with `render()` from
  `@react-email/render`, which is `renderToStaticMarkup` plus `juice` for
  inlining and `html-to-text` for the plaintext part. Ships a component
  library — `<Html>`, `<Head>`, `<Body>`, `<Container>`, `<Section>`,
  `<Row>`, `<Column>`, `<Button>`, `<Preview>` — where the layout
  primitives are tables underneath. The lessons taken: `<Preview>` is a
  real feature and costs ten lines; a plaintext alternative should be
  automatic; the component library exists because _plain divs do not
  survive Outlook_, which is the one real cost of the decision made below.
  The lesson rejected: `renderToStaticMarkup` cannot render an `async`
  component (verified: it throws "A component suspended while responding
  to synchronous input"), which is why react-email components are
  synchronous and take data as props. Flypath's are not, and should not
  have to be.
- **MJML**. An XML dialect compiled to table-based HTML with every
  Outlook conditional and VML hack baked in. The gold standard for
  rendering fidelity and the exact opposite of the requirement here:
  authors write `<mj-section>`, not the components they already use.
  Taken: its output is the reference for what a `<Row>`/`<Column>` phase
  should emit. Rejected: its authoring model.
- **Premailer / juice / `css-inline`**. Parse the HTML, parse the
  `<style>`, run the cascade, write the result into `style=""` attributes,
  and leave `@media` behind in the head. This is the industry default and
  the reason "inline your CSS" is folklore. Its cost is two parsers and a
  cascade engine, and its cause is that these tools receive HTML from an
  arbitrary pipeline. Flypath does not: the styles are in hand as data,
  one element at a time, before any HTML exists. The cascade never needs
  to be re-derived because it was never lost.
- **Rails ActionMailer**. `mail(to:, subject:)`; views are ordinary
  templates; delivery is `deliver_now` / `deliver_later` where the latter
  is just ActiveJob. Multipart is implicit from the presence of `.html`
  and `.text` templates. `config.action_mailer.default_url_options` exists
  because relative links in mail are broken and someone must supply a
  host — the same reason `mail.baseUrl` exists below. Taken wholesale:
  delivery is not a queue, it is a job; the API is one function.
- **nodemailer**. Zero transitive dependencies, 1.8 MB, ESM-first since
  v10, ships its own types, and holds the accumulated scar tissue of every
  provider's SMTP quirks: STARTTLS negotiation, `AUTH LOGIN` vs `PLAIN`
  vs `XOAUTH2`, `SIZE`, `PIPELINING`, `8BITMIME`, `LMTP`, DKIM. Its
  composer covers everything this plan would otherwise have written below
  the renderer, including `cid:` inline attachments, which was the one
  thing the first draft believed it would have to build by hand. Adopted;
  see "Options considered".
- **caniemail.com, via Mailpit**. Mailpit exposes
  `GET /api/v1/message/{id}/html-check`, which scores a delivered message
  against the caniemail support matrix and returns
  `Total: { Tests, Nodes, Supported, Partial, Unsupported }` plus a
  per-feature breakdown (verified locally against v1.31.1). That is a
  regression test for rendering decisions, not just a viewer.
- **`react-reconciler`**, as `react-pdf` and `ink` use it. A host config
  (`createInstance`, `appendChild`, `commitUpdate`, …) and React drives
  your own tree, which you then serialise. Attractive because it would
  let an `<a>` become a `<table>` without touching a string. Disqualifying
  because it is the _client_ reconciler: it renders synchronously into a
  host tree and has no notion of a component that returns a promise —
  which is what every server component in this repo is. Adopting it means
  either reimplementing the Flight renderer's async support or forbidding
  `await` in an email. It is also unversioned, pinned to React's exact
  internals, and would be a second renderer to keep alive next to the two
  already here. Rejected; see below.
- **Gmail's 102 KB clip.** Gmail truncates a message body past ~102 KB and
  shows "[Message clipped]". Every byte spent on repeated inline
  declarations is a byte closer to that. The hybrid below spends the
  bytes only where a class cannot go.
- **Litmus/Email Client Market Share, 2024–2025.** Apple Mail ~55 %,
  Gmail ~30 %, Outlook ~4–6 % of which classic Windows Outlook (the Word
  rendering engine, no flexbox, no `max-width`, no `@media`) is a shrinking
  fraction as the WebView2 "new Outlook" rolls out. That number is what
  makes the div-based decision below defensible rather than reckless.

## Options considered

### How a React tree becomes HTML

**Chosen: the RSC → SSR round trip that already exists.** `sendMail` is
called from the `rsc` environment, where the email's components live.
Render the element to a flight stream with `renderToReadableStream` from
`@vitejs/plugin-rsc/rsc`, buffer it, then
`import.meta.viteRsc.loadModule("ssr", "index")` and let the `ssr`
environment decode it and run `prerender` from `react-dom/static.edge`.
This is `server-entry.tsx`'s document path with a different shell, so it
inherits: `async` components, Suspense, error propagation via `onError`,
`<style>`/`<title>`/`<meta>` hoisting, and the fact that it already works
in `flypath dev`, in `dist/rsc/index.js` and inside `flypath work`.

Verified locally against React 19.2.8: `prerender` and Fizz's
`renderToReadableStream` produce byte-identical output once `allReady`
resolves before the stream is read; a `<style href precedence>` rendered
in `<head>` and three more rendered deep in `<body>` are merged into a
single `<style>` in `<head>` in first-seen order with duplicates removed;
`<title>` and `<meta>` written inside a `<div>` in the body are hoisted
into `<head>`.

**Rejected: `react-reconciler`.** See the field note. Async components are
a Flight-renderer feature, and every server component in this codebase is
allowed to be one.

**Rejected: a hand-written tree walker in the `rsc` environment.** ~150
lines to handle function components, fragments, arrays and text — and
then `use()`, Suspense, error boundaries and `cache()` are all missing,
and "identical to the components we already use" quietly stops being
true.

**Rejected: `renderToStaticMarkup`.** Cannot render an `async` component.

### Inline styles, embedded stylesheet, or both

**Chosen: both, split by whether the declaration _can_ be inlined.**

- A plain value (`color: "#111"`) goes in the `style` attribute. Nothing
  else. No class, no rule, no bytes in the stylesheet.
- A condition map (`{ default, "@media …", ":hover" }`) puts its
  `default` in the `style` attribute _and_ mints a class whose rules
  carry only the non-default branches, each marked `!important`.

`!important` is not decoration: an inline declaration outranks any class
rule, so without it the dark-mode branch could never win over the base
value sitting on the same element. This is the same reason every
hand-written dark-mode email in the wild is full of `!important`.

The result is that a typical email carries a `<style>` containing only
its dark-mode and hover rules and nothing else, every other declaration
sits on the element where no client can strip it, and the two never
disagree because both come from the same flattened map.

**Rejected: inline only.** Loses `@media` (dark mode, responsive) and
`:hover` entirely — the "greater styling capabilities" half of the
requirement.

**Rejected: embedded only.** Gmail's iOS/Android app on a non-Google
account strips `<style>` outright, and a clipped Gmail message can lose
the head. An email whose every declaration lives in a stylesheet renders
as unstyled text in those clients.

### Where the transform happens

**Chosen: in the jsx runtime, per element**, as a third branch beside
`createIntrinsic` and `createNativeIntrinsic`. The style prop is already
in hand as data; `flattenStyle()` already normalises it; nothing needs to
be parsed.

**Rejected: a Premailer-style post-pass over the rendered HTML.** It would
buy two things — client components in emails, and subtree `css.override`
themes — at the cost of an HTML tokenizer, a CSS parser and a cascade
engine, in a codebase whose entire styling architecture exists to avoid
needing one. The two things it buys are handled below by narrowing the
contract instead.

A consequence to be explicit about: **the email branch runs in the `rsc`
environment only.** A `"use client"` component inside an email would be
rendered by the `ssr` environment, whose jsx runtime is the web one, and
would silently produce `var()`-laden inline styles and class-only
conditionals. So an email containing a client reference throws, with a
message that says why. Emails are static; `"use client"` has no meaning
in an inbox.

### Divs or tables

**Chosen: divs, the same ones the app already uses.** The requirement is
that emails look like the components we already have; emitting tables
would mean a different component vocabulary, which is exactly what MJML
and react-email do and exactly what was asked against.

The honest cost: classic Windows Outlook (Word engine, ~2–4 % of opens
and falling) ignores `display:flex`, so a `flexDirection: "row"` layout
stacks vertically there. `flexDirection: "column"` — the shape most
emails have anyway — is identical. `max-width` is ignored, so a centred
container is full-bleed. Everything else (colours, padding, borders,
fonts, images, links) is inlined and works.

Two cheap mitigations are taken: an `<!--[if mso]>` block in the head
that fixes Outlook's 120 DPI scaling and forces
`mso-line-height-rule: exactly`, and mirroring `style.width` /
`style.backgroundColor` onto the `width` and `bgcolor` _attributes_ of
`<img>` and `<body>`, which the Word engine does honour.

A table-emitting `<Row>`/`<Column>` pair stays available as a later
phase; it is additive and changes nothing below.

### Delivery: nodemailer or written here

**Chosen: nodemailer.** Measured rather than assumed: version 10.0.1 is
**one package, zero transitive dependencies, 1.8 MB**, ESM-first
(`"type": "module"`, `engines: node >= 20`), and it **ships its own
types** — no `@types/nodemailer`. For scale, `oxc-parser` already in this
repo is 1.4 MB.

The first draft of this plan wrote the transport by hand and justified it
with "the MIME builder has to be written regardless, because the renderer
produces a `cid:` set that must become `multipart/related` parts". That
claim is false. `attachments: [{ cid, content, filename }]` is
nodemailer's native API, and its output — verified locally — is _better_
than the structure this plan originally specified: it nests
`multipart/related` **inside** `multipart/alternative` around the HTML
part alone, rather than wrapping the whole alternative, which is the more
correct reading of RFC 2387. Content type is inferred from the filename,
`Content-ID: <logo>` and `Content-Disposition: inline` are automatic.

So the load-bearing argument for hand-rolling did not hold, and with it
goes roughly 730 lines across four files and three test files:

| Planned                                                      | Covered by                                   |
| ------------------------------------------------------------ | -------------------------------------------- |
| `mime.ts` — quoted-printable, base64, boundaries, structure  | `mail-composer`, `mime-node`, `qp`, `base64` |
| `headers.ts` — RFC 2047 words, folding, `Date`, `Message-ID` | `mime-funcs`                                 |
| `address.ts` — parsing, formatting, encoded display names    | `addressparser`                              |
| `smtp.ts` — the conversation, STARTTLS, `AUTH`, dot-stuffing | `smtp-connection`, `smtp-transport`          |

And it arrives with things this plan had given up on: **DKIM signing**
(previously "Not in this plan"), **connection pooling** (previously a
"later optimisation"), `SIZE`/`PIPELINING`/`8BITMIME`/`XOAUTH2`, and
`streamTransport`/`jsonTransport`, which is the memory transport the
tests wanted, for free.

Two details verified on the wire rather than trusted, both of which the
hand-rolled client would have had to get right:

- `createTransport("smtp://user:pass@host:587")` takes the connection URL
  directly, which is the `SMTP_URL` requirement almost verbatim.
- **`Bcc` never reaches the wire.** A socket-level capture of the exact
  bytes sent confirms `Bcc:` is absent from the transmitted message while
  every blind recipient still appears in `RCPT TO`. (`streamTransport`
  _does_ keep the header, because there the caller owns the envelope —
  worth knowing, since that is the transport the tests use.)

What nodemailer does **not** do, and stays in this plan: generate a
`text/plain` alternative from HTML. Verified — an html-only message
produces a single `text/html` part, no fallback. `mail/text.ts` survives.

**What is given up.** Control over the exact wire format, worth nothing
here; and one dependency in `package.json`. Against that, the deleted
code was concentrated in the two areas where a bug is worst — transfer
encoding and TLS — and would have been ours to own forever.

The `Transport` seam still exists, now as a thin adapter, so a provider
API (SES, Resend, Postmark) slots in later without touching the renderer.

### Where the subject comes from

**Chosen: `<Subject>` records the text in an AsyncLocalStorage collector
_and_ renders a `<title>`.** The collector gets the exact string with no
HTML-entity round trip, typed as text so `<Subject><img/></Subject>` is a
compile error; the `<title>` is good practice and free, since React
hoists it into `<head>` from anywhere in the tree.

The collector is the same store that flags "we are rendering an email"
for the jsx runtime, and it survives the Flight render for the same
reason `params()` and `cookies()` do inside server components today:
`runWithRequest` establishes an ALS scope around `toFlight()` and React's
scheduling propagates it.

**Rejected: scraping `<title>` out of the finished HTML.** Requires
decoding entities to recover the author's string, and cannot distinguish
a subject from a page title that a shared component happened to render.

## Shape

```
src/
  mail/
    index.ts        sendMail, the public types
    config.ts       MailOptions, configureMail(), mailConfig(), smtpUrl()
    context.ts      the render ALS: isEmail(), the collector
    document.tsx    the shell, <Subject>, <Preview>
    render.tsx      element -> { html, text, subject, cids }
    finish.ts       the HTML tidy pass
    text.ts         HTML -> text/plain
    transport.ts    Transport, smtpTransport(), memoryTransport()
  styles/
    email.ts        emailStyle(), EMAIL_RESET, EMAIL_DEFAULTS
  runtime/
    element-email.ts  createEmailIntrinsic()
    stream.ts         collect() / replay(), moved out of server-entry
test/
  mail/
    style.test.ts     emailStyle
    document.test.tsx the shell, Subject, Preview, hoisting, finish
    text.test.ts      HTML -> text
    transport.test.ts SMTP_URL parsing, the message mapping, envelope
    send.test.ts      end to end, against Mailpit
    harness.ts        Mailpit spawn/clear/read
```

`src/mail/` is the only new directory; `styles/email.ts` and
`runtime/element-email.ts` sit beside their web and native siblings and
are named for them. Six of the twelve files the first draft planned are
gone: `mime.ts`, `headers.ts`, `address.ts` and `smtp.ts` are nodemailer's
job, and `mime.test.ts`, `address.test.ts` and `smtp.test.ts` go with
them.

## The API

### Sending

```ts
import { sendMail } from "flypath";

await sendMail({ to: "someone@example.com", content: <WelcomeEmail name="Someone" /> });
```

```ts
type Address = string | { name?: string; email: string };

type Attachment = {
  filename: string;
  content: Uint8Array | ArrayBuffer | string;
  contentType?: string;
  cid?: string;
  inline?: boolean;
};

type MailMessage = {
  to: Address | readonly Address[];
  from?: Address;
  cc?: Address | readonly Address[];
  bcc?: Address | readonly Address[];
  replyTo?: Address | readonly Address[];
  returnPath?: string;
  subject?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
  content?: ReactNode;
  html?: string;
  text?: string | false;
  attachments?: readonly Attachment[];
  headers?: Readonly<Record<string, string>>;
  baseUrl?: string;
};

type MailResult = {
  messageId: string;
  accepted: readonly string[];
  rejected: readonly string[];
  response: string;
};

function sendMail(message: MailMessage): Promise<MailResult>;
```

`content` and `html` are alternatives; exactly one is required. `subject`
overrides whatever `<Subject>` recorded. `text` is derived from the HTML
unless given, and `text: false` omits the alternative. `to`, `cc` and
`bcc` all become `RCPT TO`; `bcc` never becomes a header.

`sendMail` is server-only. `index.client.ts` gets the same
`serverOnly("sendMail")` stub `db`, `jobs` and `cron` already have.

Sending blocks the response, so the shape to reach for is a job:

```tsx
// app/mail.tsx
export async function sendWelcome(userId: number): Promise<void> {
  const user = await db()
    .from("users")
    .where("id", "=", userId)
    .select("name", "email")
    .first();
  if (!user) return;
  await sendMail({
    to: user.email,
    content: <WelcomeEmail name={user.name} />,
  });
}
```

```ts
await jobs().enqueue(() => sendWelcome(user.id));
```

### The components

```tsx
function Subject(props: { children: Text }): ReactNode;
function Preview(props: { children: Text }): ReactNode;
```

where `Text` is `string | number | readonly (string | number)[]`, so
`<Subject>Welcome, {name}!</Subject>` type-checks and
`<Subject><b>no</b></Subject>` does not.

- **`Subject`** records the joined text and renders `<title>`. Called
  twice, the last wins. Called outside an email render, it throws.
- **`Preview`** renders the preheader: a hidden `div` holding the text
  followed by a run of zero-width padding so the client does not pull
  body copy into the inbox summary. It renders where it is written, so it
  belongs first in the tree.
  **There is no wrapper component at all** — no `Email`, no `Body`, no
  `Html`. The renderer always supplies `<html><head>…</head><body>`, so the
  sketch in the brief — a bare `<div>` containing `<Subject>`, a `<meta>`
  and a `<p>` — works verbatim, and an email component is indistinguishable
  from a page component.

An earlier draft had an optional `<Email>` root carrying document-level
props, identified by reference. It is gone, because none of the three
things it carried survived scrutiny:

- `preview` duplicated `<Preview>`, which already exists.
- `lang` and `dir` describe the _message_, not its markup, so they belong
  on `sendMail` beside `subject` — which is where they now are.
- `style` on `<body>` was the only real one, and it is the wrong
  mechanism for email regardless. Body backgrounds are unreliable across
  clients — the Word engine wants `bgcolor` on a full-width table — so
  every real-world email paints a full-bleed background with a wrapper
  element instead. That wrapper is an ordinary `<div>` with an ordinary
  `style`, which means it goes through `emailStyle()` and gets the
  dark-mode `!important` treatment for free. `<Email style>` would have
  needed its own plumbing to route a `StyleProp` onto a `<body>` the
  framework renders, to reach a worse result.

**Nor is `<html>` the answer.** A page never writes it — `documentShell`
(`runtime/server-entry.tsx:72`) owns the document — so letting an email
write one would break the symmetry this whole plan rests on. It is not
even expressible today: `html`, `head` and `body` are absent from
`JSX.IntrinsicElements` (`runtime/jsx.ts:12`), and adding them would make
them legal in pages too, where they would collide with the shell. The
email path therefore **throws** on `html`, `head` and `body`, pointing at
the escape hatch below.

**The escape hatch already exists.** Someone who wants the whole document
— a designer's HTML, an unusual `<head>` — passes `sendMail({ html })`
with a string and skips the renderer entirely. Everything short of that
is reachable without `<head>` access anyway, because React hoists
`<style>`, `<meta>`, `<title>` and `<link>` into the head from anywhere in
the tree.

### Configuration

```ts
// vite.config.ts
export default defineConfig({
  mail: {
    from: "Flypath <hello@example.com>",
    baseUrl: "https://example.com",
  },
});
```

```
# .env
SMTP_URL=smtp://localhost:1025
MAIL_FROM=Flypath <hello@example.com>
APP_URL=http://localhost:8081
```

Declared options win, `.env` fills the gaps, exactly like
`databaseOptions()`. With none of them set, `sendMail` throws
`flypath: no mail transport is configured; set SMTP_URL in .env` — the
sibling of the message `connectionUrl()` already produces.

`SMTP_URL` is a URL:

- `smtp://user:pass@host:587` — plain, upgraded with `STARTTLS` when the
  server advertises it. Default port 587.
- `smtps://user:pass@host:465` — TLS from the first byte. Default port 465.
- `?tls=required` fails if `STARTTLS` is not advertised; `?tls=off`
  never upgrades.
- `?rejectUnauthorized=false` for a dev server with a self-signed
  certificate.
- User and password are percent-decoded, so a password containing `@` or
  `:` survives.

`baseUrl` (or `APP_URL`) is what relative `href` and `src` are resolved
against. Inside a request it falls back to that request's origin; with
neither, a relative URL throws with the attribute and element named.

### Images

`<img>` works three ways and all of them are supported:

- **Absolute URL** — passed through.
- **Relative URL** — resolved against `baseUrl`. `href("/p/:id", …)`
  becomes `https://example.com/p/1`.
- **`cid:name`** — matched against an attachment whose `cid` is `name`.
  The part is emitted inline inside `multipart/related` with
  `Content-ID: <name>` and `Content-Disposition: inline`. A `cid:` with
  no matching attachment throws, naming the id; an attachment with a
  `cid` nothing references is a dev warning.

Every `<img>` additionally gets `border="0"` and, when `style.width` or
`style.height` is a plain number, the matching `width`/`height`
attribute, because the Word engine reads attributes and not CSS. A
missing `alt` is a dev warning.

## How it works

### The two passes

```
sendMail(message)
  ├─ config: from, baseUrl, transport
  ├─ renderEmail(content, { baseUrl })
  │   ├─ collector = { subject: undefined, cids: new Set(), warnings: [] }
  │   ├─ runInMail(collector, () =>
  │   │      renderToReadableStream(<EmailDocument …>{content}</EmailDocument>, { onError }))
  │   ├─ bytes = await collect(stream);  if (onError saw one) throw it
  │   ├─ ssr = await import.meta.viteRsc.loadModule("ssr", "index")
  │   ├─ html = await ssr.renderEmailHtml(replay(bytes))
  │   └─ finishEmail(html)
  ├─ text = message.text ?? htmlToText(html)
  ├─ check every collected cid: against attachments
  └─ transport.send(message, { html, text, subject })
         nodemailer composes the MIME and speaks SMTP
```

The flight stream is buffered before the SSR pass rather than piped, so
that an error thrown by a server component surfaces out of `sendMail`
instead of producing half an email. `collect()` and `replay()` move from
`server-entry.tsx` into `runtime/stream.ts` and both callers use them.

`renderEmailHtml` is a new export of `ssr-entry.tsx`: decode with
`createFromReadableStream`, render with `prerender` from
`react-dom/static.edge`, read the prelude to a string.

### The email intrinsic

`jsx-runtime.server.ts` and `jsx-dev-runtime.server.ts` grow one branch,
**before** the native one:

```ts
if (isEmail()) return createEmailIntrinsic(jsxFn, jsxsFn, Fragment, type, props, key);
if (isNative()) return createNativeIntrinsic(…);
return createIntrinsic(…);
```

The order matters and is not cosmetic. An email sent from an iOS request
renders inside a request whose `platform()` is `"ios"`; without the email
check first, `isNative()` would send the whole message down the native
path and produce a flight payload of `<Text>` primitives.

`createEmailIntrinsic` is `createIntrinsic` with five differences:

1. It starts from `EMAIL_DEFAULTS[tag]` — the browser defaults
   `TAG_DEFAULTS` already records, plus `margin: 0` for the tags that
   have one — and layers the author's style over it, so the message
   survives a client that strips `<style>`.
2. It calls `emailStyle()` instead of `webStyle()`.
3. It rewrites `href` on `<a>` and `src` on `<img>` against `baseUrl`,
   collects `cid:` references, and mirrors width/height/bgcolor onto
   attributes.
4. Metadata tags (`title`, `meta`) pass through untouched so React can
   hoist them.
5. `html`, `head` and `body` throw. The renderer owns the document, and
   an author who wants to own it instead passes `sendMail({ html })` with
   a string — which is what the error says. They are not in
   `JSX.IntrinsicElements` either, so this only fires on a cast or on
   plain `createElement`; it exists so the failure is a sentence rather
   than a mangled message with two `<html>` elements in it.

The `<style>` elements it emits are the same
`<style href={className} precedence="flypath">` the web path emits, so
React's hoisting does the collection, ordering and dedupe. The shell
renders `EMAIL_RESET` first under the same precedence, which puts the
reset at the top of the merged `<style>` where it belongs.

### `emailStyle()`

```ts
export type EmailStyle = {
  style: Record<string, Scalar> | undefined;
  classes: string[];
  rules: AtomicRule[];
};
```

For each entry of `flattenStyle(input).props`:

- **A plain scalar.** Serialised with `cssValue()` into the inline style.
- **A `var(--x, fb)` string.** Resolved the way `styles/native.ts:57`
  resolves it: `lookupVar("--x")` from the registry the styles plugin
  populates in the `rsc` environment (`vite/styles.ts` appends
  `registerVars`/`registerKeyframes` for `rsc` and native
  environments). A scalar becomes the literal; a condition map becomes
  the condition-map case below, which is how a `css.vars` token with a
  `prefers-color-scheme` branch turns into a real dark-mode email; an
  unregistered token falls back to the literal written in the `var()`
  fallback slot, and with no fallback either, a dev error naming the
  token.
- **A condition map**, whether written inline or arriving as the
  build-time `$c`/`$v` marker `extractStyles()` produces (in which case
  the `$c` classes are ignored and `$v` is used, exactly as
  `nativeStyle()` does). Its `default` goes inline; the rest becomes
  `atomicRule(property, map, { important: true, skipDefault: true })`.
- **`--x` theme entries** from `css.override()`. Dropped, with a dev
  error: an inline custom property only reaches descendants through the
  cascade, which is the one thing a per-element transform cannot see, and
  silently ignoring it would make the email disagree with the page. The
  workaround is to pass the value as a prop.

`atomicRule()` grows an options argument — `important`, `skipDefault`,
and a `variant` string folded into the hash so an email rule and a web
rule for the same property never collide on one class name.

Results are memoised per style object in a `WeakMap`, as `webStyle()`
already does.

Properties an inbox cannot honour anywhere — `position`, `zIndex`,
`transform`, `transformOrigin`, `pointerEvents`, `userSelect`, `cursor`,
`overflowX`, `overflowY` — are emitted anyway (they cost nothing where
they are ignored) with a dev warning that names the element. Animations
are the exception and throw: `animationName` refers to a `@keyframes`
that lives in `virtual:flypath/styles.css`, which no email ever loads, so
emitting the declaration would be a silent lie.

### The shell

```tsx
<html dir={dir} lang={lang}>
  <head>
    <meta charSet="utf-8" />
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="light dark" name="color-scheme" />
    <meta content="light dark" name="supported-color-schemes" />
    <style href="fp-email-reset" precedence="flypath">
      {EMAIL_RESET}
    </style>
  </head>
  <body>{children}</body>
</html>
```

`lang` and `dir` come from `sendMail`, defaulting to `en` and unset. The
shell is the whole of the document vocabulary: everything else an author
would reach into `<head>` for — a `<style>`, a `<meta>`, a `<title>` —
hoists there on its own from anywhere in the tree.

`EMAIL_RESET` is `RESET` (`styles/defaults.ts:1`) minus the parts that
describe a viewport rather than a document — `html, body { height: 100% }`,
`body { display: flex; overflow: hidden }`, the `[data-fp-scroll]` rules —
plus what an inbox needs: `img { border: 0; outline: none; -ms-interpolation-mode: bicubic }`,
`table { border-collapse: collapse }`,
`:root { color-scheme: light dark; supported-color-schemes: light dark }`,
and `a { text-decoration: none }`. Keeping the shared half is the whole
point: `* { box-sizing: border-box }`, `* { margin: 0 }` and
`p, h1…h6 { overflow-wrap: break-word }` are why the same component looks
the same in both places.

### `finishEmail()`

React's output needs four narrow edits, all of them on markup React
itself produced, none of them a general HTML parse:

1. **Strip `<link rel="preload">`.** React 19 emits
   `<link rel="preload" as="image" href="…">` for every `<img src>`
   (verified). In an email it is dead weight, and for a `cid:` source it
   is nonsense.
2. **Strip `data-precedence` and `data-href`** from the merged `<style>`.
3. **Strip Suspense markers** — `<!--$-->`, `<!--/$-->`, `<!--$?-->`,
   `<!--$!-->`.
4. **Insert the `<!--[if mso]>` block** after `<head>`: the
   `o:OfficeDocumentSettings` `PixelsPerInch` fix and
   `* { mso-line-height-rule: exactly }`. React cannot emit a conditional
   comment, and this is the only reason the pass exists at all.

In dev it also warns when the finished HTML exceeds 100 KB, because
Gmail clips at ~102 KB.

### `htmlToText()`

A single forward scan of the finished HTML, no tree:

- `<head>`, `<style>`, `<script>` and any element whose inline style
  contains `display:none` (the preheader) are skipped wholesale.
- Block tags (`div p h1…h6 section article header footer main nav aside
blockquote figure figcaption form pre li tr`) emit a line break;
  `<br>` emits one; runs of three or more collapse to two.
- `<a href="x">text</a>` becomes `text (x)`, unless the text already is
  the href.
- `<img alt="x">` becomes `[x]` when `alt` is non-empty.
- Entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` and numeric forms are
  decoded; whitespace inside text collapses; the result is trimmed with
  one trailing newline.

### Delivery

Everything below `renderEmail` is nodemailer, wrapped thinly enough that
the wrapper is worth reading in full:

```ts
type Envelope = { from: string; to: readonly string[] };

type Transport = {
  send: (message: MailMessage, rendered: Rendered) => Promise<MailResult>;
};
```

`smtpTransport(url)` is `nodemailer.createTransport(url)` plus the
flypath-specific mapping, which is the only part worth spelling out:

- **`SMTP_URL` goes in as a URL string.** `createTransport` accepts
  `smtp://user:pass@host:587` and `smtps://host:465` directly, including
  percent-decoded credentials. Flypath parses it first anyway, to reject a
  bad URL with its own message rather than a library one, and to read the
  `?tls=required|off` and `?rejectUnauthorized=false` query parameters
  into `{ requireTLS, ignoreTLS, tls: { rejectUnauthorized } }`.
- **The message maps almost one to one.** `to`/`cc`/`bcc`/`replyTo`/
  `subject`/`html`/`text`/`headers` are nodemailer's own field names.
  Flypath's `Address` union (`string | { name, email }`) is normalised to
  nodemailer's `{ name, address }` on the way in.
- **`cid:` attachments are native.** The set the renderer collected is
  checked against `attachments` — a `cid:` with no attachment throws
  naming the id, an attachment nothing references warns — and then handed
  over unchanged. Nodemailer produces `multipart/alternative[ text,
related[ html, inline… ] ]`, with `Content-ID`, `Content-Disposition:
inline` and a content type inferred from the filename.
- **`Bcc` is stripped on the wire by the SMTP transport** while every
  blind recipient still appears in `RCPT TO`, verified by socket capture.
  No flypath code is needed for it. The one caveat is `streamTransport`,
  which keeps the header because there the caller owns the envelope —
  which matters only because that is what the tests use.
- **`Message-ID` and `Date`** are nodemailer's unless `headers` overrides
  them.
- **Errors** carry nodemailer's `code`/`responseCode`; the wrapper adds
  `retryable` (4xx yes, 5xx no) so a job's retry policy behaves, and
  rethrows as `MailError` so callers never import nodemailer to catch
  something.

`memoryTransport()` is `nodemailer.createTransport({ streamTransport: true,
buffer: true })`, which returns the composed message as bytes and is what
most tests assert against.

Two integration details, both consequences of nodemailer being a Node
library in a Vite-bundled server:

- It must be **external** in the `rsc` and `ssr` environments — it reaches
  for `node:net`, `node:tls`, `node:dns` and `node:crypto` — and must
  never enter the client graph. `sendMail` is already server-only with a
  throwing client stub, so the barrier exists; the vite config needs the
  externalisation to match.
- It is a **runtime dependency** of the framework package, so it goes in
  `dependencies`, not `peerDependencies`: an app should not have to know
  the transport exists.

Pooling, DKIM signing, `SIZE`, `PIPELINING`, `8BITMIME` and `XOAUTH2` are
all reachable through the same transport options and none of them need a
line here to work.

## What changes

New: everything under `src/mail/`, `src/styles/email.ts`,
`src/runtime/element-email.ts`, `src/runtime/stream.ts`, `test/mail/`.

Edited:

- `src/runtime/jsx-runtime.server.ts:24` and
  `src/runtime/jsx-dev-runtime.server.ts:35` — the `isEmail()` branch,
  before `isNative()`.
- `src/runtime/jsx.ts:12` — `meta` (and `link`) added to
  `JSX.IntrinsicElements`, so the `<meta>` in the brief type-checks.
- `src/runtime/intrinsics.ts:3` — `meta` and `link` added to `METADATA`,
  so they render nothing on native instead of throwing.
- `src/styles/atomic.ts:22` — `atomicRule()` takes
  `{ important, skipDefault, variant }`, with `variant` folded into the
  class-name hash.
- `src/runtime/server-entry.tsx:147,168` — `collect()`/`replay()` move to
  `runtime/stream.ts`.
- `src/runtime/ssr-entry.tsx` — exports `renderEmailHtml()`.
- `src/native/config.ts:17` — `FlypathOptions.mail`.
- `src/vite/plugins.ts` — a `virtual:flypath/mail` module beside
  `virtual:flypath/database`, imported by `server-entry.tsx`, calling
  `configureMail()`.
- `src/vite/index.ts:92` — `mail` destructured in `withFlypath`.
- `src/cli.ts:22` — `declareOptions()` also calls `configureMail()`, so
  `flypath work` sends with the same configuration the server has.
- `src/index.server.ts` — exports `sendMail`, `Subject`, `Preview` and
  the mail types.
- `src/index.client.ts` — `serverOnly("sendMail")` and throwing component
  stubs, matching what `db`, `jobs` and `cron` already do.
- `package.json` — `nodemailer` added to `dependencies` (not
  `peerDependencies`: an app should not have to know the transport
  exists).
- `src/vite/plugins.ts` — `nodemailer` externalised in the `rsc` and
  `ssr` environments; it reaches for `node:net`, `node:tls`, `node:dns`
  and `node:crypto` and must never enter the client graph.
- `knip.json` — `src/mail/document.tsx` is reached only through the
  barrel; no new entry expected, but check.

## Tests

The seams are chosen so that everything except the flight round trip is
testable without Vite. Encoding, address parsing and the SMTP conversation
are no longer tested here at all — they are nodemailer's, tested there.
What is tested is the rendering, and the mapping into nodemailer. `test/mail/document.test.tsx` renders the shell
straight through `react-dom/static.edge`, which vitest can import
directly and which — verified — renders `async` components; the round
trip itself is thin glue proven by the example and by
`test/mail/send.test.ts`.

**`style.test.ts`** — `emailStyle()`. A plain value inlines and mints no
class. A condition map inlines its `default` and emits only the
non-default branches, each `!important`. `:hover` becomes
`.fp-x:hover { … !important }`. A registered `var()` resolves to its
literal; a registered condition-map token becomes an inline default plus
a media rule; an unregistered token falls back to the `var()` fallback
and, with none, throws. A `$c`/`$v` marker resolves through `$v`.
Shorthands expand (`padding: 8` → four longhands). Numbers gain `px`
except for the unitless set. `--x` theme entries throw. `animationName`
throws. `position` warns in dev and still emits. Two different rules
never share a class name.

**`document.test.tsx`** — the shell and the finish pass. `<Subject>`
records the subject and renders `<title>`; the last one wins; used
outside an email it throws. A `<meta>` written inside a `<div>` in the
body lands in `<head>`. Every atomic rule lands in exactly one `<style>`
in `<head>` with `EMAIL_RESET` first and duplicates collapsed. `<img>`
gains `border="0"` and a `width` attribute from a numeric
`style.width`; a relative `src` and a relative `href` are absolutised
against `baseUrl`; a `cid:` with no attachment throws; a missing `alt`
warns. `<Preview>` produces the hidden div with padding. `<html>`,
`<head>` and `<body>` each throw, naming `sendMail({ html })`. `lang` and
`dir` from `sendMail` reach `<html>`. A `"use client"` component in the
tree throws with the message that says why. After `finishEmail`: no `<link rel=preload>`, no `data-precedence`,
no `<!--$-->`, and the mso block present exactly once directly after
`<head>`.

**`text.test.ts`** — block breaks, `<br>`, collapsed blank runs, links
rendered as `text (url)` and not duplicated when they match, `alt` text,
entity decoding including numeric and hex forms, the preheader excluded,
`<style>` contents excluded, trailing newline.

**`transport.test.ts`** — the wrapper, not nodemailer. `SMTP_URL`
parsing: `smtp://` defaults to 587 and `smtps://` to 465, credentials
percent-decode, `?tls=required` and `?tls=off` become `requireTLS` and
`ignoreTLS`, `?rejectUnauthorized=false` reaches the TLS options, a
malformed URL throws flypath's message and not a library one, and no URL
at all throws the `set SMTP_URL in .env` message. The message mapping:
flypath's `Address` union normalises to `{ name, address }`; a `cid:`
referenced with no matching attachment throws naming the id; an
attachment nothing references warns; a 4xx reply becomes
`MailError { retryable: true }` and a 5xx `retryable: false`, both
rethrown so no caller imports nodemailer to catch. Asserted against
`memoryTransport()`, which hands back the composed bytes.

**`send.test.ts`** — end to end against Mailpit, spawned by
`harness.ts` on free ports (skipped with a clear message if the binary is
absent). Send a message with a non-ASCII subject, an inline `cid:` image,
a regular attachment and a `bcc`; read it back from
`/api/v1/message/latest` and assert the decoded `Subject`, the `To`/`Cc`
lists, that `Bcc` is absent from the raw source at
`/api/v1/message/latest/raw` while the blind recipient still received it,
the `HTML` and `Text` parts, and that `Inline[0]` carries the expected
`Content-ID`. Then `GET /api/v1/message/latest/html-check` and assert
`Total.Unsupported` stays under a committed threshold and that no
newly-unsupported feature slug appears — a regression test for every
rendering decision above, backed by caniemail's matrix.

## Phases

### Phase 0 — the style target

`styles/email.ts` with `emailStyle()`, `EMAIL_RESET` and
`EMAIL_DEFAULTS`; `atomicRule()` gains its options. `style.test.ts`
passes. Nothing renders yet.

### Phase 1 — the intrinsic and the document

`runtime/element-email.ts`, `mail/context.ts`, `mail/document.tsx`,
`mail/finish.ts`; the `isEmail()` branch in both server jsx runtimes;
`meta`/`link` added to the intrinsics and to `METADATA`.
`document.test.tsx` passes by rendering through `react-dom/static.edge`
directly. An email can be turned into a string in a test, but not yet
from an app.

### Phase 2 — the render round trip

`runtime/stream.ts`; `renderEmailHtml()` in `ssr-entry.tsx`;
`mail/render.tsx`. `renderEmail()` works inside `flypath dev` and prints
HTML. Still no sending.

### Phase 3 — plaintext and delivery

`mail/text.ts`, `mail/transport.ts`, `mail/config.ts`, `mail/send.ts`;
the nodemailer dependency and its externalisation; `SMTP_URL` parsing;
the vite `mail` option and its virtual module; the CLI wiring; the
barrels. `text.test.ts`, `transport.test.ts` and `send.test.ts` pass.
`sendMail` works from a server action, a server component and a job.

This was two phases before nodemailer; the MIME and SMTP phases are gone.

### Phase 4 — the example earns it

A migration adds `users.email`; `notifyMentions` renders and sends a
`MentionEmail` to each mentioned user; `example/.env` gets
`SMTP_URL=smtp://localhost:1025`; `WelcomeEmail` is imported by a page as
well as by the mailer to prove the components really are the same ones.
The milestone at the top is met end to end against a local Mailpit.

## Key decisions

- **The email renderer is the page renderer.** RSC → flight → SSR, the
  same two passes `server-entry.tsx` already runs, with a different
  shell. An email may therefore be an `async` server component that
  queries the database, which is the only reason the components can
  honestly be called "the ones we already use".
- **`react-reconciler` is rejected** because it renders synchronously and
  has no story for `async` components — the thing this codebase's
  components are.
- **Styles are inlined where they can be and embedded where they cannot,
  from one flattened map.** Unconditional declarations go on the element;
  condition maps put their `default` on the element and their branches in
  one `<style>` in `<head>`, `!important` so they can still win. React's
  own `precedence` hoisting does the collection and dedupe, so there is
  no stylesheet assembler to write.
- **`var()` is resolved to a literal** against the same registry
  `styles/native.ts` already reads, because no `var()` survives Gmail or
  the Word engine — and because a token whose value is a condition map
  becomes a real dark-mode email for free.
- **The transform is per element, in the jsx runtime**, not a post-pass
  over HTML. No HTML parser, no CSS parser, no cascade engine. The price
  is paid in two narrowed contracts: `css.override()` themes and
  `"use client"` components are errors inside an email, both with
  messages that say why.
- **Divs, not tables.** The requirement was the components we already
  have. Classic Outlook degrades to stacked full-width blocks; the mso
  conditional and the width/bgcolor attribute mirrors take the cheap wins.
  `<Row>`/`<Column>` remain available later and change nothing here.
- **`<Subject>` is a component that records text, not a scraped
  `<title>`** — exact strings, a compile error for non-text children, and
  a `<title>` rendered anyway because it costs nothing.
- **There is no wrapper component.** The renderer supplies the document
  and an email component is indistinguishable from a page component. An
  `<Email>` root was drafted and cut: its `preview` duplicated
  `<Preview>`, its `lang`/`dir` describe the message and moved to
  `sendMail`, and its `style` on `<body>` was the wrong mechanism — email
  backgrounds are painted with a wrapper element, which is an ordinary
  `<div>` that gets `emailStyle()` for free. `<html>` is not the
  alternative either: pages never write it, and making it legal would
  make it legal in pages too. `sendMail({ html })` is the full-control
  escape hatch, and `html`/`head`/`body` throw pointing at it.
- **Delivery is nodemailer.** The first draft wrote it by hand on the
  argument that MIME was unavoidable anyway; that argument was wrong —
  `attachments: [{ cid }]` is nodemailer's native API and its part nesting
  is more correct than what this plan had specified. One package, zero
  transitive dependencies, 1.8 MB, its own types. It deletes ~730 lines
  across four files and three test files, concentrated in the two places a
  bug hurts most — transfer encoding and TLS — and it arrives with DKIM
  and pooling, both of which this plan had given up on. The `Transport`
  seam stays, now thin, for a provider API later.
- **Delivery is not a queue.** `jobs()` already retries, dedupes and runs
  elsewhere; `sendMail` stays a function you call from one.

## Not in this plan

- **DKIM signing**, though it is now one transport option away rather
  than a project. Without DKIM and SPF alignment mail to real inboxes
  lands in spam, so exposing `mail.dkim` is likely the first follow-up.
- **Provider transports** — SES, Resend, Postmark. The `Transport` seam
  exists for them.
- **Table layout primitives** (`<Row>`, `<Column>`, `<Container>`) for
  Outlook parity.
- **A dev preview route.** `/__mail` listing every exported email
  component with a live render would want a scan like `jobs-scan.ts`; it
  is the obvious next DX win and entirely additive.
- **Bounce, complaint and open tracking**, `List-Unsubscribe` beyond what
  `headers` already allows.
- **Web fonts.** `@font-face` and font `<link>`s do not work in Gmail or
  Outlook; emails use the system stack.
- **`css.override()` themes and `"use client"` components inside an
  email.** Both throw. Lifting either means the HTML post-pass this plan
  rejected.
- **Animations in email.** `animationName` throws; inlining `@keyframes`
  into the email stylesheet is possible and small, but only Apple Mail
  would see it.
- **Localisation.** `I18N` is its own line in `TODO`.

## Risks / open questions

- **`import.meta.viteRsc.loadModule("ssr", …)` inside `flypath work`.**
  The worker imports `dist/rsc/index.js` directly rather than through a
  server, and nothing has yet exercised the SSR hop from that process.
  It should work — the loader is compiled into the bundle — but Phase 3
  must prove it, because "send mail from a job" is the primary use case.
  If it does not, the fallback is to render the email in-process with a
  flight client rather than reaching into the `ssr` environment.
- **AsyncLocalStorage across the Flight render.** The email collector
  relies on the same propagation `params()` and `cookies()` already
  depend on inside server components. It is the established mechanism,
  but the failure mode — a subject silently going missing — is quiet, so
  `renderEmail` should throw when `content` rendered without ever
  producing a subject and none was supplied.
- **Regexes on React's output.** `finishEmail()` edits markup by pattern.
  It only ever touches strings React itself produced, and each edit is
  anchored, but a future React version could change the shape of a
  hoisted `<style>` or a preload link. The `document.test.tsx`
  assertions are the tripwire; if it gets hairier than four patterns, the
  answer is a small tag scanner, not a bigger regex.
- **Style extraction leaks email rules into the app stylesheet.**
  `extractStyles()` (`vite/extract.ts`) mints atomic rules for every
  condition map it finds in any `.tsx` and adds them to
  `virtual:flypath/styles.css`, including ones that only an email uses.
  Harmless — a few unused bytes — but worth measuring before deciding it
  is harmless.
- **Outlook.** The div decision is a bet on the market-share trend. If
  classic Outlook matters for a given app, the `<Row>`/`<Column>` phase
  is the answer, and it is additive.
- **Gmail's 102 KB clip.** Inlining spends bytes. The dev warning at
  100 KB is the guard; if real emails start bumping it, the lever is to
  move more properties into classes and accept the GANGA degradation, or
  to deduplicate identical inline style strings into shared classes.
- **Bundling nodemailer.** It must stay external in the `rsc` and `ssr`
  environments and out of the client graph entirely. The failure mode is
  loud (a build error about `node:tls`, or a browser bundle that grew by
  1.8 MB), so it is cheap to catch, but it is the one integration detail
  the dependency introduces.
- **`streamTransport` keeps the `Bcc` header** where the SMTP transport
  strips it, because there the caller owns the envelope. Since
  `memoryTransport()` is `streamTransport`, a test that asserts "no `Bcc`
  in the message" would pass against SMTP and fail against memory, or
  worse, be written the other way round and assert nothing. The Bcc
  assertion belongs in `send.test.ts` against Mailpit's raw source, which
  is where this plan puts it.
- **`SMTPUTF8` and internationalised addresses.** Nodemailer advertises
  and uses `SMTPUTF8` where the server offers it, but flypath's own
  `Address` normalisation should be checked against a non-ASCII local
  part rather than assumed to pass through.
