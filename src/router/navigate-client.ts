import { getRouter } from "./dispatch.ts";
import { buildHref, isExternal } from "./href.ts";
import { makeNavigate } from "./navigate.ts";
import type { Navigate } from "./types.ts";

export const navigate: Navigate = makeNavigate(
  (to, params, mode, permanent): void => {
    if (permanent) {
      throw new Error(
        "flypath: navigate.permanent() ran in the browser; a permanent " +
          "redirect is an HTTP answer, so it only works in a server " +
          "component or a server action",
      );
    }

    if (to === "not-found") {
      throw new Error(
        'flypath: navigate("not-found") ran in the browser; it answers a ' +
          "request, so it only works in a server component or a server action",
      );
    }

    const router = getRouter();
    if (!router) {
      throw new Error(
        `flypath: navigate("${to}") ran before the flypath router was ready`,
      );
    }

    if (to === "back") {
      router.back();
      return;
    }

    router.go(
      isExternal(to)
        ? to
        : buildHref(to, params as Readonly<Record<string, unknown>>),
      mode ?? "push",
    );
  },
);
