import type { Mode } from "./types.ts";

export type NavigationSignal =
  | {
      readonly kind: "go";
      readonly to: string;
      readonly mode: Mode;
      readonly permanent: boolean;
    }
  | { readonly kind: "back" }
  | { readonly kind: "not-found" };

export type NavigationCommand =
  | { readonly kind: "go"; readonly to: string; readonly mode: Mode }
  | { readonly kind: "back" };

export class NavigationError extends Error {
  readonly flypathSignal: NavigationSignal;

  constructor(signal: NavigationSignal) {
    super(
      signal.kind === "go"
        ? `flypath: navigate to ${signal.to}`
        : signal.kind === "back"
          ? "flypath: navigate back"
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
  if (kind === "go" || kind === "back" || kind === "not-found") {
    return signal as NavigationSignal;
  }
  return undefined;
}

export function encodeCommand(signal: NavigationSignal): string {
  const command: NavigationCommand =
    signal.kind === "go"
      ? { kind: "go", to: signal.to, mode: signal.mode }
      : { kind: "back" };
  return JSON.stringify(command);
}

export function parseCommand(
  value: string | null | undefined,
): NavigationCommand | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { kind, to, mode } = parsed as {
    kind?: unknown;
    to?: unknown;
    mode?: unknown;
  };
  if (kind === "back") return { kind: "back" };
  if (kind !== "go" || typeof to !== "string") return undefined;
  return { kind: "go", to, mode: mode === "replace" ? "replace" : "push" };
}

export type Location = {
  readonly url: string;
  readonly container: string | undefined;
  readonly route: string;
  readonly params: Readonly<Record<string, string>>;
};

export function encodeLocation(location: Location): string {
  return JSON.stringify(location);
}

export function parseLocation(
  value: string | null | undefined,
): Location | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { url, container, route, params } = parsed as {
    url?: unknown;
    container?: unknown;
    route?: unknown;
    params?: unknown;
  };
  if (typeof url !== "string") return undefined;
  return {
    url,
    container: typeof container === "string" ? container : undefined,
    route: typeof route === "string" ? route : "",
    params:
      params === null || typeof params !== "object"
        ? {}
        : (params as Readonly<Record<string, string>>),
  };
}
