import path from "node:path";
import { stripVTControlCharacters, styleText } from "node:util";

export type Stream = {
  write: (chunk: string) => boolean;
  isTTY?: boolean;
  columns?: number;
  hasColors?: () => boolean;
};

type Tone = "accent" | "green" | "yellow" | "red" | "dim" | "bold";

const FORMATS: Record<Tone, Parameters<typeof styleText>[0]> = {
  accent: "magenta",
  green: "green",
  yellow: "yellow",
  red: "red",
  dim: "dim",
  bold: "bold",
};

export type Paint = Record<Tone, (text: string) => string>;

function flag(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value !== "" && value !== "0" && value !== "false";
}

function ascii(): boolean {
  return process.env["TERM"] === "dumb";
}

function colorful(stream: Stream): boolean {
  const force = flag("FORCE_COLOR");
  if (force !== undefined) return force;
  if (flag("NO_COLOR") === true) return false;
  if (ascii()) return false;
  return stream.isTTY === true && (stream.hasColors?.() ?? true);
}

export function paint(stream: Stream): Paint {
  const on = colorful(stream);
  const tone =
    (name: Tone) =>
    (text: string): string =>
      on && text !== ""
        ? styleText(FORMATS[name], text, { validateStream: false })
        : text;
  return {
    accent: tone("accent"),
    green: tone("green"),
    yellow: tone("yellow"),
    red: tone("red"),
    dim: tone("dim"),
    bold: tone("bold"),
  };
}

export type Mark = "done" | "warn" | "error" | "change" | "pending";

const UNICODE: Record<Mark, string> = {
  done: "✓",
  warn: "!",
  error: "✗",
  change: "↻",
  pending: "○",
};

const ASCII: Record<Mark, string> = {
  done: "+",
  warn: "!",
  error: "x",
  change: "~",
  pending: "o",
};

const MARK_TONES: Record<Mark, Tone> = {
  done: "green",
  warn: "yellow",
  error: "red",
  change: "dim",
  pending: "dim",
};

export function mark(kind: Mark, stream: Stream): string {
  const symbol = (ascii() ? ASCII : UNICODE)[kind];
  return paint(stream)[MARK_TONES[kind]](symbol);
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SPINNER_ASCII = ["-", "\\", "|", "/"];

export function frames(): readonly string[] {
  return ascii() ? SPINNER_ASCII : BRAILLE;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60))}m ${String(total % 60)}s`;
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

export function size(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 999_500) {
    const kb = bytes / 1000;
    return `${kb >= 100 ? String(Math.round(kb)) : kb.toFixed(1)} kB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function relative(file: string, root: string = process.cwd()): string {
  const out = path.relative(root, file);
  return out === "" || out.startsWith("..") || path.isAbsolute(out)
    ? file
    : out;
}

export function file(name: string, stream: Stream): string {
  const shown = relative(name);
  const at = shown.lastIndexOf("/");
  if (at === -1) return shown;
  return `${paint(stream).dim(shown.slice(0, at + 1))}${shown.slice(at + 1)}`;
}

function width(text: string): number {
  return stripVTControlCharacters(text).length;
}

export function column(text: string, size: number): string {
  const length = width(text);
  return length + 2 > size
    ? `${text}  `
    : `${text}${" ".repeat(size - length)}`;
}

export function strip(text: string): string {
  return stripVTControlCharacters(text);
}
