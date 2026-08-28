import { index, layout, route, routes, tabs } from "flypath/router";

// prettier-ignore
const config = routes([
  layout(() => import("./shell.tsx"), [
    tabs(() => import("./tab-bar.tsx"), [
      index(() => import("./feed.tsx"), { title: "Home" }),
      route("explore", () => import("./explore.tsx"), { title: "Explore", prefetch: "hover" }),
      route("me", () => import("./profile.tsx"), { title: "Profile" }),
    ]),
    route("p/:id", () => import("./post.tsx"), { title: "Post", presentation: "modal", safeArea: ["top"] }),
    route("*", () => import("./not-found.tsx"), { title: "Not found" }),
  ]),
]);

export default config;

declare module "flypath" {
  interface Register {
    routes: typeof config;
  }
}
