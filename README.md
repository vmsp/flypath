# flypath

**EXPERIMENTAL. Do not use this in production as things will break.**

Flypath is a full-stack framework for Web, iOS and Android native applications
using Server-Driven UI (SDUI). The backend owns the UI and the logic that drives
it. Clients just render what they're sent.

Some high-traffic apps like [Instagram
Lite](https://thenewstack.io/instagram-lite-is-no-longer-a-progressive-web-app-now-a-native-app-built-with-bloks/),
[Airbnb](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5),
[Uber](https://www.reddit.com/r/androiddev/comments/1046xel/comment/j35yr8c/)
and [Reddit](https://www.infoq.com/news/2023/09/reddit-feed-server-driven-ui/)
follow the SDUI pattern.

## Features

**One codebase, three platforms.** The same code renders to React on the Web and
to React Native on Android and iOS. `<h1>`, `<p>`, `<form>` and the rest are the
whole vocabulary, and styling is the `style` attribute you already know —
type-safe, and compiled away at build time so no styling runtime ships.

**Real native navigation.** Nothing is a WebView. Every screen is drawn with
real native views, and navigation is the platform's own — stacks, modals and
safe areas, with swipe-back working by default on iOS.

**The backend is in the component.** Built on React Server Components, so data
loading lives next to the markup that needs it and RPC is type-safe end to end.
Pages are server-side rendered by default, with pre-rendering opt-in per route.
Every path, param and `href` is derived from the route tree, so a link that goes
nowhere is a type error, and middleware, cookies and headers behave the same on
the Web and on native.

**Batteries included.** A complete and fully type-safe SQL layer for PostgreSQL,
with types flowing from the schema through to the row you get back. Django style
migrations: specify the schema (tables, views, enums, extensions) and the
migration is generated. Background jobs and crons with retries, backoff and
priorities, depending only on PostgreSQL: no Redis, no broker. Emails written as
JSX, with the components and the styling the app already has.

**Native when you need it.** `"use native"` gives plain Swift and Kotlin
(functions, async and SwiftUI or Android views) fully typed from TypeScript,
with the bindings generated for you.

**One command to ship.** Web, iOS and Android from a single CLI, with no Xcode
project and no Metro config to keep. Most logic lives on the server, so native
apps change over-the-air without an App Store or Play round trip. Built on Vite
and OXC: crazy fast.

## Acknowledgments

Some amazing projects like [React](https://react.dev/), [React
Native](https://reactnative.dev/), [Vite](https://vite.dev/) and
[OXC](https://oxc.rs/) form the core of the implementation. [React Strict
DOM](https://react.github.io/react-strict-dom/) heavily inspired the styling
engine. [Ruby on Rails](https://rubyonrails.org/) guided many of the API
choices. The migration system comes from
[Django](https://www.djangoproject.com/). Using JSX to write email messages
comes from [React Email](https://react.email/).

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
