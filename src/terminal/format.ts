import type {
  DeviceEvent,
  ErrorEvent,
  Event,
  JobEvent,
  RequestEvent,
} from "../shared/events.ts";
import { print, printError } from "./output.ts";
import type { Stream } from "./style.ts";
import { column, duration, file, mark, paint } from "./style.ts";

export type FormatOptions = { names?: boolean };

const TARGET = 20;

function status(code: number, stream: Stream): string {
  const p = paint(stream);
  const text = String(code);
  if (code < 300) return p.green(text);
  if (code < 400) return text;
  if (code < 500) return p.yellow(text);
  return p.red(text);
}

function request(event: RequestEvent, stream: Stream, names: boolean): string {
  const p = paint(stream);
  const target =
    names && event.action !== undefined
      ? `${event.path}  ${event.action}()`
      : event.path;
  const tail: string[] = [];
  if (names && event.location !== undefined) tail.push(`→ ${event.location}`);
  if (names && event.prerendered === true) tail.push("prerendered");
  return [
    event.method.padEnd(5),
    column(target, TARGET),
    status(event.status, stream),
    "  ",
    p.dim(event.platform.padEnd(7)),
    p.dim(duration(event.ms).padStart(6)),
    tail.length === 0 ? "" : `  ${p.dim(tail.join("  "))}`,
  ].join("");
}

function job(event: JobEvent, stream: Stream): string {
  const p = paint(stream);
  const tone =
    event.state === "done"
      ? p.green
      : event.state === "retry"
        ? p.yellow
        : p.red;
  const state =
    event.state === "done"
      ? "done"
      : `${event.state} ${String(event.attempt)}/${String(event.attempts)}`;
  const when =
    event.state === "retry" && event.retryIn !== undefined
      ? `in ${duration(event.retryIn)}`
      : duration(event.ms);
  const error =
    event.state !== "done" && event.error !== undefined
      ? `   ${p.dim(event.error.split("\n")[0] ?? "")}`
      : "";
  return `${p.dim("job")}  ${column(event.job, TARGET)}${tone(state)}${" ".repeat(Math.max(2, 11 - state.length))}${p.dim(when)}${error}`;
}

function device(event: DeviceEvent, stream: Stream): string {
  const p = paint(stream);
  const [first = "", ...rest] = event.text.split("\n");
  const lead =
    event.level === "error"
      ? `${mark("error", stream)} `
      : event.level === "warn"
        ? `${mark("warn", stream)} `
        : "";
  const text = event.level === "debug" ? p.dim(first) : first;
  const indent = " ".repeat(event.platform.length + 2 + (lead === "" ? 0 : 2));
  return [
    `${p.dim(event.platform)}  ${lead}${text}`,
    ...rest.map((line) => `${indent}${p.dim(line)}`),
  ].join("\n  ");
}

export function reporter(
  stream: Stream = process.stderr,
): (event: Event) => void {
  return (event) => {
    if (event.kind === "error") {
      printError(event.error);
      return;
    }
    print(format(event, stream));
  };
}

export function format(
  event: Exclude<Event, ErrorEvent>,
  stream: Stream,
  options: FormatOptions = {},
): string {
  switch (event.kind) {
    case "request":
      return request(event, stream, options.names ?? true);
    case "job":
      return job(event, stream);
    case "device":
      return device(event, stream);
    case "change":
      return `${mark("change", stream)} ${file(event.file, stream)}`;
  }
}
