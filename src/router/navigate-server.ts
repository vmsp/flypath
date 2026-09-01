import { getRequest } from "../runtime/platform.ts";
import { buildHref, isExternal } from "./href.ts";
import { makeNavigate } from "./navigate.ts";
import { NavigationError } from "./navigation.ts";
import type { Mode, Navigate } from "./types.ts";

function phase(): "render" | "action" {
  return getRequest()?.phase ?? "render";
}

export const navigate: Navigate = makeNavigate(
  (to, params, mode, permanent): void => {
    if (to === "not-found") {
      throw new NavigationError({ kind: "not-found" });
    }

    if (to === "back") {
      if (phase() !== "action") {
        throw new Error(
          'flypath: navigate("back") ran during a server render; there is no ' +
            "history to pop until the page exists, so it works in a server " +
            "action or a client event handler",
        );
      }
      throw new NavigationError({ kind: "back" });
    }

    const fallback: Mode = phase() === "action" ? "push" : "replace";
    throw new NavigationError({
      kind: "go",
      to: isExternal(to)
        ? to
        : buildHref(to, params as Readonly<Record<string, unknown>>),
      mode: mode ?? fallback,
      permanent,
    });
  },
);
