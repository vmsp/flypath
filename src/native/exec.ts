import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { verbose } from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
import { relative } from "../terminal/style.ts";
import { tail } from "./diagnostics.ts";

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  failure?: (output: string) => string[];
  attach?: boolean;
};

type Log = { path: string; fd: number };

let log: Log | undefined;

export function startLog(root: string, name: string): string {
  const file = path.join(
    root,
    "node_modules",
    ".flypath",
    "logs",
    `${name}.log`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (log) fs.closeSync(log.fd);
  log = { path: file, fd: fs.openSync(file, "w") };
  return file;
}

function tee(text: string): void {
  if (log) fs.writeSync(log.fd, text);
}

class CommandError extends FlypathError {
  readonly command: string;

  readonly code: number | null;

  readonly output: string;

  readonly log: string | undefined;

  constructor(options: {
    command: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    output: string;
    log: string | undefined;
    details: readonly string[];
  }) {
    const name = path.basename(options.command);
    super(
      options.signal === null
        ? `${name} exited with code ${String(options.code)}`
        : `${name} was stopped by ${options.signal}`,
      {
        brief: true,
        details: [
          ...options.details,
          ...(options.log === undefined
            ? []
            : ["", `Full log  ${relative(options.log)}`]),
        ],
      },
    );
    this.name = "CommandError";
    this.command = options.command;
    this.code = options.code;
    this.output = options.output;
    this.log = options.log;
  }
}

function splitter(onLine: ((line: string) => void) | undefined): {
  push: (text: string) => void;
  end: () => void;
} {
  let pending = "";
  return {
    push(text) {
      if (!onLine) return;
      pending += text;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) onLine(part.replace(/\r$/, ""));
    },
    end() {
      if (onLine && pending !== "") onLine(pending.replace(/\r$/, ""));
      pending = "";
    },
  };
}

export function run(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<string> {
  tee(`$ ${[command, ...args].join(" ")}\n`);
  const attach = options.attach === true;
  const echo = verbose();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [attach ? "inherit" : "ignore", "pipe", "pipe"],
    });

    let output = "";
    const streams = [splitter(options.onLine), splitter(options.onLine)];
    const take =
      (index: number) =>
      (chunk: Buffer): void => {
        const text = chunk.toString();
        output += text;
        tee(text);
        if (attach) {
          (index === 0 ? process.stdout : process.stderr).write(text);
        } else if (echo) {
          process.stderr.write(text);
        }
        streams[index]?.push(text);
      };
    child.stdout?.on("data", take(0));
    child.stderr?.on("data", take(1));

    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new FlypathError(`${command} was not found`, {
              hint: "Install it, or put it on PATH",
              cause: error,
            })
          : error,
      );
    });

    child.on("close", (code, signal) => {
      for (const stream of streams) stream.end();
      if (code === 0) {
        resolve(output);
        return;
      }
      const explained = options.failure?.(output) ?? [];
      reject(
        new CommandError({
          command,
          code,
          signal,
          output,
          log: log?.path,
          details: explained.length > 0 ? explained : tail(output),
        }),
      );
    });
  });
}
