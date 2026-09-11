import { globals } from "./globals.ts";

export type RequestEvent = {
  kind: "request";
  method: string;
  path: string;
  status: number;
  platform: "web" | "ios" | "android";
  ms: number;
  action?: string;
  location?: string;
  prerendered?: boolean;
};

export type JobEvent = {
  kind: "job";
  job: string;
  state: "done" | "retry" | "failed";
  ms: number;
  attempt: number;
  attempts: number;
  retryIn?: number;
  error?: string;
};

export type DeviceEvent = {
  kind: "device";
  platform: string;
  level: "log" | "warn" | "error" | "debug";
  text: string;
};

type ChangeEvent = {
  kind: "change";
  file: string;
};

export type ErrorEvent = {
  kind: "error";
  error: unknown;
};

export type Event =
  | RequestEvent
  | JobEvent
  | DeviceEvent
  | ChangeEvent
  | ErrorEvent;

export function reporting(): boolean {
  return globals().report !== undefined;
}

export function report(event: Event): boolean {
  const sink = globals().report;
  if (!sink) return false;
  try {
    sink(event);
  } catch {}
  return true;
}
