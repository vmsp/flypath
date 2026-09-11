import {
  branches,
  index,
  layout,
  notFound,
  route,
  routes,
  stack,
} from "flypath/router";

import { auth, post, request } from "./middleware.ts";

const config = routes([
  layout(
    () => import("./shell.tsx"),
    [
      stack({ middleware: [request] }, [
        branches(
          () => import("./tab-bar.tsx"),
          [
            stack([index(() => import("./feed.tsx"))]),
            stack([
              route("explore", () => import("./explore.tsx"), {
                prefetch: "hover",
              }),
            ]),
            stack({ middleware: [auth] }, [
              route("me", () => import("./profile.tsx"), {
                revalidate: "blocking",
              }),
            ]),
            route("p/:id", () => import("./post.tsx"), {
              middleware: [post],
              safeArea: ["top"],
            }),
          ],
        ),
        route("login", () => import("./login.tsx"), { safeArea: ["top"] }),
        route("camera", () => import("./viewfinder.tsx"), {
          safeArea: ["top"],
        }),
        route("settings", () => import("./settings.tsx"), {
          middleware: [auth],
          safeArea: ["top"],
        }),
        route("compose", () => import("./compose.tsx"), {
          middleware: [auth],
          presentation: "modal",
          safeArea: ["top"],
        }),
      ]),
      route("about", () => import("./about.tsx"), { prerender: true }),
      notFound(() => import("./not-found.tsx")),
    ],
  ),
]);

export default config;

declare module "flypath" {
  interface Register {
    routes: typeof config;
  }
}
