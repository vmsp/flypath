import type { Mode } from "./types.ts";

export const NAVIGATE_HEADER = "x-flypath-navigate";

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
