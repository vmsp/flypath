import type { Href } from "./types.ts";

export type NavigationSignal =
  | { readonly kind: "redirect"; readonly to: string; readonly status: number }
  | { readonly kind: "not-found" };

export class NavigationError extends Error {
  readonly flypathSignal: NavigationSignal;

  constructor(signal: NavigationSignal) {
    super(
      signal.kind === "redirect"
        ? `flypath: redirect to ${signal.to}`
        : "flypath: not found",
    );
    this.name = "NavigationError";
    this.flypathSignal = signal;
  }
}

export function navigationSignal(error: unknown): NavigationSignal | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const signal = (error as Record<string, unknown>)["flypathSignal"];
  if (signal === null || typeof signal !== "object") return undefined;
  const kind = (signal as { kind?: unknown }).kind;
  if (kind === "redirect" || kind === "not-found") {
    return signal as NavigationSignal;
  }
  return undefined;
}

export function redirect(
  to: Href,
  options: { permanent?: boolean } = {},
): never {
  throw new NavigationError({
    kind: "redirect",
    to: to as string,
    status: options.permanent === true ? 308 : 307,
  });
}

export function notFound(): never {
  throw new NavigationError({ kind: "not-found" });
}
