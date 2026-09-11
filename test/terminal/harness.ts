import { afterEach, beforeEach } from "vitest";

import { setStream } from "../../src/terminal/output.ts";

export class FakeStream {
  chunks: string[] = [];

  isTTY: boolean;

  columns = 120;

  constructor(tty: boolean) {
    this.isTTY = tty;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  text(): string {
    return this.chunks.join("");
  }

  lines(): string[] {
    return this.text()
      .split("\n")
      .filter((line) => line.trim() !== "");
  }
}

const KEYS = ["NO_COLOR", "FORCE_COLOR", "TERM", "CI", "FLYPATH_VERBOSE"];

export function plainTerminal(): void {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) saved.set(key, process.env[key]);
    process.env["NO_COLOR"] = "1";
    process.env["TERM"] = "xterm-256color";
    delete process.env["FORCE_COLOR"];
    delete process.env["CI"];
    delete process.env["FLYPATH_VERBOSE"];
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setStream(process.stderr);
  });
}
