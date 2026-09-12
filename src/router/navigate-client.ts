import { getRouter } from "./dispatch.ts";
import { buildHref, isExternal } from "./href.ts";
import { makeNavigate } from "./navigate.ts";
import type { Navigate } from "./types.ts";

export const navigate: Navigate = makeNavigate(
  (to, params, mode, permanent): void => {
    if (permanent) {
      throw new Error(
        "navigate.permanent() cannot run in the browser. Call it from a server component or server action",
      );
    }

    if (to === "not-found") {
      throw new Error(
        'navigate("not-found") cannot run in the browser. Call it from a server component or server action',
      );
    }

    const router = getRouter();
    if (!router) {
      throw new Error(
        `navigate("${to}") ran before the flypath router was ready`,
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
