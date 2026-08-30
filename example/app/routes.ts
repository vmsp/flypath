import {
  branches,
  index,
  layout,
  notFound,
  route,
  routes,
  stack,
} from "flypath/router";

// prettier-ignore
const config = routes([
  layout(() => import("./shell.tsx"), [
    stack([
      branches(() => import("./tab-bar.tsx"), [
        stack([index(() => import("./feed.tsx"))]),
        stack([route("explore", () => import("./explore.tsx"), { prefetch: "hover" })]),
        stack([route("me", () => import("./profile.tsx"))]),
        route("p/:id", () => import("./post.tsx"), { safeArea: ["top"] }),
      ]),
      route("settings", () => import("./settings.tsx"), { safeArea: ["top"] }),
      route("compose", () => import("./compose.tsx"), { presentation: "modal", safeArea: ["top"] }),
    ]),
    notFound(() => import("./not-found.tsx")),
  ]),
]);

export default config;

declare module "flypath" {
  interface Register {
    routes: typeof config;
  }
}
