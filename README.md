# flypath

**EXPERIMENTAL. Do not use this in production as things will break.**

Flypath is a full-stack framework for Web, iOS and Android native applications
using Server-Driven UI (SDUI).

SDUI makes the backend fully own the UI and its controlling logic making it very
easy to release app updates over-the-air, without requiring App Store or Google
Play approval. Despite adopting web-first semantics due to their familiarity,
all UI is natively rendered on each platform and can use native code.

Some high-traffic apps like [Instagram
Lite](https://thenewstack.io/instagram-lite-is-no-longer-a-progressive-web-app-now-a-native-app-built-with-bloks/),
[Airbnb](https://medium.com/airbnb-engineering/a-deep-dive-into-airbnbs-server-driven-ui-system-842244c5f5),
[Uber](https://www.reddit.com/r/androiddev/comments/1046xel/comment/j35yr8c/)
and [Reddit](https://www.infoq.com/news/2023/09/reddit-feed-server-driven-ui/)
follow a similar pattern.

## Acknowledgements

Some amazing projects like React, React Native, React Server Components, Vite
and OXC Transforms form the core of the implementation. React Strict DOM heavily
inspired the styling engine.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
