import type { LogErrorOptions, Logger, LogOptions } from "vite";

import { change, printError, print, verbose, warn } from "./output.ts";
import { strip } from "./style.ts";

export type TerminalLogger = Logger & {
  flush: () => number;
};

export type TerminalLoggerOptions = {
  collect?: boolean;
};

const RESTARTING = /^(.+?) changed, restarting server/;

const BUILD_FAILED = /^[✗x] Build failed in /;

function dependency(text: string): boolean {
  return text.includes("node_modules");
}

const ours = new WeakSet<object>();

export function isTerminalLogger(logger: Logger): boolean {
  return ours.has(logger);
}

export function terminalLogger(
  options: TerminalLoggerOptions = {},
): TerminalLogger {
  const logged = new WeakSet<object>();
  const once = new Set<string>();
  const collected: string[] = [];
  let hidden = 0;
  let reason: string | undefined;

  const verbatim = (message: string): void => {
    for (const line of message.split("\n")) print(line);
  };

  const logger: TerminalLogger = {
    hasWarned: false,

    info(message: string, _options?: LogOptions) {
      if (verbose()) {
        verbatim(message);
        return;
      }
      const text = strip(message).trim();
      const restarting = RESTARTING.exec(text);
      if (restarting) {
        reason = restarting[1];
        return;
      }
      if (text === "server restarted.") {
        change(
          reason === undefined ? "Restarted" : `Restarted — ${reason} changed`,
        );
        reason = undefined;
      }
    },

    warn(message: string, _options?: LogOptions) {
      logger.hasWarned = true;
      if (verbose()) {
        verbatim(message);
        return;
      }
      const text = strip(message).trim();
      if (dependency(text)) {
        hidden += 1;
        return;
      }
      if (options.collect) collected.push(text);
      else warn(text);
    },

    warnOnce(message: string, logOptions?: LogOptions) {
      if (once.has(message)) return;
      once.add(message);
      logger.warn(message, logOptions);
    },

    error(message: string, logOptions?: LogErrorOptions) {
      logger.hasWarned = true;
      const error = logOptions?.error ?? undefined;
      if (error) {
        if (logged.has(error)) return;
        logged.add(error);
      }
      if (verbose()) {
        verbatim(message);
        return;
      }
      const text = strip(message).trim();
      if (!error && BUILD_FAILED.test(text)) return;
      printError(error ?? new Error(text));
    },

    clearScreen() {},

    hasErrorLogged(error) {
      return logged.has(error);
    },

    flush() {
      const count = collected.length;
      for (const text of collected) warn(text);
      if (count > 0 && hidden > 0) {
        print(
          `  ${String(hidden)} more from dependencies — --verbose to list them`,
        );
      }
      collected.length = 0;
      hidden = 0;
      return count;
    },
  };

  ours.add(logger);
  return logger;
}
