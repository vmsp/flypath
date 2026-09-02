import {
  branches,
  index,
  layout,
  notFound,
  route,
  routes,
  stack,
} from "flypath/router";

import { auth, request } from "./middleware.ts";

const config = routes({ middleware: [request] }, [
  layout(
    () => import("./shell.tsx"),
    [
      stack([
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
            route("p/:id", () => import("./post.tsx"), { safeArea: ["top"] }),
          ],
        ),
        route("login", () => import("./login.tsx"), { safeArea: ["top"] }),
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
