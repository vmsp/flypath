import fs from "node:fs";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";

import { verbose as verboseFlag } from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
import { packageRoot } from "../shared/paths.ts";
import type { Stream } from "./style.ts";
import {
  clock,
  column,
  duration,
  frames,
  mark,
  paint,
  relative,
  strip,
} from "./style.ts";

export type Row = readonly [label: string, value: string];

export type Progress = {
  status: (text: string) => void;
  summary: (text: string) => void;
  done: (label: string) => void;
};

export type StepLabel =
  | string
  | { active: string; done: string; failed?: string };

export type StepOptions = { time?: boolean };

type Live = { label: string; status: string; started: number };

type Write = (chunk: unknown, ...rest: unknown[]) => boolean;

const LABEL = 32;

let out: Stream = process.stderr;
const live: Live[] = [];
const originals = new Map<Stream, Write>();
const shown = new WeakSet<object>();
let drawn = false;
let midline = false;
let tick = 0;
let timer: NodeJS.Timeout | undefined;
let headed = false;
let known: string | undefined;

export function setStream(stream: Stream): void {
  out = stream;
}

export function verbose(): boolean {
  return verboseFlag();
}

function interactive(): boolean {
  const ci = process.env["CI"];
  return (
    out.isTTY === true &&
    process.env["TERM"] !== "dumb" &&
    (ci === undefined || ci === "" || ci === "0" || ci === "false")
  );
}

function raw(text: string): void {
  const write = originals.get(out);
  if (write) write.call(out, text);
  else out.write(text);
}

function clear(): void {
  if (!drawn) return;
  raw("\r\u001B[2K");
  drawn = false;
}

function draw(): void {
  const top = live.at(-1);
  if (!top || midline || timer === undefined) return;
  const p = paint(out);
  const spinner = frames();
  const time = clock(performance.now() - top.started);
  const label = column(top.label, LABEL);
  const room =
    (out.columns !== undefined && out.columns > 0 ? out.columns : 80) - 1;
  const budget = room - 4 - label.length - time.length - 2;
  let status = top.status;
  if (status.length > budget) {
    status = budget > 1 ? `${status.slice(0, budget - 1)}…` : "";
  }
  const frame = spinner[tick % spinner.length] ?? "";
  raw(
    `\r\u001B[2K  ${p.accent(frame)} ${label}${status === "" ? "" : `${p.dim(status)}  `}${p.dim(time)}`,
  );
  drawn = true;
}

function emit(text: string): void {
  clear();
  raw(`${text}\n`);
  midline = false;
  draw();
}

function decode(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return "";
}

function wrap(): void {
  for (const stream of new Set<Stream>([process.stdout, process.stderr, out])) {
    if (originals.has(stream)) continue;
    const original = stream.write as unknown as Write;
    originals.set(stream, original);
    (stream as unknown as { write: Write }).write = (chunk, ...rest) => {
      clear();
      const result = original.call(stream, chunk, ...rest);
      const text = decode(chunk);
      if (text !== "") midline = !text.endsWith("\n");
      draw();
      return result;
    };
  }
}

function unwrap(): void {
  for (const [stream, write] of originals) {
    (stream as unknown as { write: Write }).write = write;
  }
  originals.clear();
}

function restoreTerminal(): void {
  clear();
  raw("\u001B[?25h");
}

function interrupted(): void {
  restoreTerminal();
  if (process.listenerCount("SIGINT") > 1) return;
  process.off("SIGINT", interrupted);
  process.kill(process.pid, "SIGINT");
}

function begin(entry: Live): void {
  live.push(entry);
  if (timer === undefined) {
    if (!interactive()) return;
    wrap();
    raw("\u001B[?25l");
    const handle = setInterval(() => {
      tick += 1;
      draw();
    }, 80) as unknown as NodeJS.Timeout;
    handle.unref();
    timer = handle;
    process.on("exit", restoreTerminal);
    process.on("SIGINT", interrupted);
  }
  clear();
  draw();
}

function end(entry: Live): void {
  const at = live.indexOf(entry);
  if (at !== -1) live.splice(at, 1);
  if (timer === undefined) return;
  clear();
  if (live.length > 0) return;
  clearInterval(timer);
  timer = undefined;
  unwrap();
  raw("\u001B[?25h");
  process.off("exit", restoreTerminal);
  process.off("SIGINT", interrupted);
}

function settled(
  kind: "done" | "error",
  label: string,
  ms: number | undefined,
  summary: string,
): string {
  const p = paint(out);
  const parts: string[] = [];
  if (ms !== undefined) parts.push(p.dim(duration(ms).padStart(6)));
  if (summary !== "") parts.push(p.dim(summary));
  const head = `  ${mark(kind, out)} `;
  if (parts.length === 0) return `${head}${label}`;
  return `${head}${column(label, LABEL)}${parts.join("   ")}`.trimEnd();
}

function explain(error: unknown): void {
  if (!(error instanceof FlypathError)) return;
  if (!error.brief) emit(`    ${error.message}`);
  describe(error);
  shown.add(error);
}

function describe(error: FlypathError): void {
  const p = paint(out);
  if (error.hint !== undefined) {
    for (const line of error.hint.split("\n")) emit(`    ${p.dim(line)}`);
  }
  if (error.details.length > 0) {
    emit("");
    for (const line of error.details) {
      emit(line === "" ? "" : `    ${p.dim(line)}`);
    }
  }
  if (verbose()) {
    emit("");
    for (const line of stackLines(error.stack, true))
      emit(`      ${p.dim(line)}`);
  }
}

export type Handle = Progress & {
  finish: () => void;
  fail: (error?: unknown) => void;
};

export function open(label: StepLabel, options: StepOptions = {}): Handle {
  const names =
    typeof label === "string"
      ? { active: label, done: label, failed: label }
      : { ...label, failed: label.failed ?? label.active };
  const entry: Live = {
    label: names.active,
    status: "",
    started: performance.now(),
  };
  let summary = "";
  let done = names.done;
  let closed = false;

  begin(entry);
  return {
    status: (text) => {
      entry.status = text;
    },
    summary: (text) => {
      summary = text;
    },
    done: (text) => {
      done = text;
    },
    finish: () => {
      if (closed) return;
      closed = true;
      end(entry);
      emit(
        settled(
          "done",
          done,
          options.time === false
            ? undefined
            : performance.now() - entry.started,
          summary,
        ),
      );
    },
    fail: (error) => {
      if (closed) return;
      closed = true;
      end(entry);
      emit(settled("error", names.failed, undefined, ""));
      if (error !== undefined) explain(error);
    },
  };
}

export async function step<T>(
  label: StepLabel,
  run: (progress: Progress) => Promise<T>,
  options: StepOptions = {},
): Promise<T> {
  const handle = open(label, options);
  let result: T;
  try {
    result = await run(handle);
  } catch (error) {
    handle.fail(error);
    throw error;
  }
  handle.finish();
  return result;
}

export function flypathVersion(): string {
  if (known !== undefined) return known;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { version?: string };
    known = parsed.version ?? "";
  } catch {
    known = "";
  }
  return known;
}

function closing(): void {
  clear();
  raw("\n");
}

export function intro(title?: string): void {
  emit("");
  if (title !== undefined) {
    emit(`  ${title}`);
    emit("");
  }
  if (!headed) process.once("exit", closing);
  headed = true;
}

export function header(command: string, entries: readonly Row[] = []): void {
  const p = paint(out);
  intro(
    `${p.bold(p.accent("flypath"))} ${p.dim(flypathVersion())}  ${command}`,
  );
  if (entries.length > 0) {
    rows(entries);
    emit("");
  }
}

export function rows(entries: readonly Row[]): void {
  const size = Math.max(...entries.map(([label]) => label.length)) + 2;
  for (const [label, value] of entries) emit(`  ${label.padEnd(size)}${value}`);
}

export function print(line: string): void {
  emit(line === "" ? "" : `  ${line}`);
}

export function blank(): void {
  emit("");
}

export function note(text: string): void {
  const p = paint(out);
  for (const line of text.split("\n")) emit(`    ${p.dim(line)}`);
}

export function success(label: string, detail = ""): void {
  const p = paint(out);
  emit(
    `  ${mark("done", out)} ${label}${detail === "" ? "" : `  ${p.dim(detail)}`}`,
  );
}

export function change(text: string): void {
  emit(`  ${mark("change", out)} ${text}`);
}

export function warn(message: string, hint?: string): void {
  const p = paint(out);
  const [first = "", ...rest] = message.split("\n");
  emit(`  ${mark("warn", out)} ${first}`);
  for (const line of [
    ...rest,
    ...(hint === undefined ? [] : hint.split("\n")),
  ]) {
    emit(line.trim() === "" ? "" : `    ${p.dim(line)}`);
  }
}

function stackLines(stack: string | undefined, all: boolean): string[] {
  if (stack === undefined) return [];
  const root = process.cwd();
  const flypath = `${packageRoot}/dist/`;
  const every = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => line.replaceAll("file://", ""));
  const kept = all
    ? every
    : every.filter(
        (line) =>
          !line.includes("node:internal") &&
          (!line.includes("/node_modules/") || line.includes(flypath)),
      );
  return kept.map((line) => line.replaceAll(`${root}/`, ""));
}

type Located = {
  id?: unknown;
  loc?: { file?: unknown; line?: unknown; column?: unknown };
  frame?: unknown;
};

export function printError(error: unknown): void {
  const p = paint(out);
  if (typeof error === "object" && error !== null) shown.add(error);
  if (error instanceof FlypathError) {
    const [first = "", ...rest] = error.message.split("\n");
    emit(`  ${mark("error", out)} ${first}`);
    for (const line of rest) emit(`    ${line}`);
    describe(error);
    return;
  }
  if (!(error instanceof Error)) {
    emit(`  ${mark("error", out)} ${String(error)}`);
    return;
  }

  const message = strip(error.message);
  const [first = "", ...rest] = message.split("\n");
  const name = error.name === "Error" ? "" : `${error.name}: `;
  emit(`  ${mark("error", out)} ${name}${first}`);
  for (const line of rest) {
    if (line.trim() === "" || line.trim().startsWith("at ")) continue;
    emit(`    ${p.dim(line)}`);
  }

  const located = error as Located;
  const file =
    typeof located.loc?.file === "string"
      ? located.loc.file
      : typeof located.id === "string"
        ? located.id
        : undefined;
  if (file !== undefined) {
    const at =
      typeof located.loc?.line === "number"
        ? `:${String(located.loc.line)}:${String(located.loc.column ?? 0)}`
        : "";
    emit(`    ${p.dim(`${relative(file)}${at}`)}`);
  }
  if (typeof located.frame === "string" && located.frame.trim() !== "") {
    for (const line of strip(located.frame).split("\n")) {
      emit(`    ${p.dim(line)}`);
    }
  }

  const frames = stackLines(error.stack, verbose());
  for (const line of frames) emit(`      ${p.dim(line)}`);
  if (frames.length === 0 && stackLines(error.stack, true).length > 0) {
    emit(`    ${p.dim("--verbose for the full stack")}`);
  }
  if (verbose() && error.cause !== undefined) {
    emit(`    ${p.dim("Caused by")}`);
    printError(error.cause);
  }
}

export function fail(error: unknown): never {
  if (typeof error !== "object" || error === null || !shown.has(error)) {
    printError(error);
  }
  process.exit(1);
}
