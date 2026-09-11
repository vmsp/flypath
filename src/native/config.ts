import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { JobsOptions } from "../jobs/config.ts";
import type { MailOptions } from "../mail/config.ts";
import type { ServeOptions } from "../serve/config.ts";
import { FlypathError } from "../shared/errors.ts";

export const CONFIG_PLUGIN = "flypath:config";

export const DEFAULT_PORT = 8081;

export type Orientation =
  | "portrait"
  | "portraitUpsideDown"
  | "landscapeLeft"
  | "landscapeRight";

export type FlypathOptions = {
  /** Named databases and their pool options. */
  databases?: Record<
    string,
    {
      url?: string | undefined;
      max?: number;
      idleTimeout?: number;
      connectTimeout?: number;
      searchPath?: string;
      ssl?: boolean | "require" | "prefer";
    }
  >;

  /** Background job queues, their policies and retention. */
  jobs?: JobsOptions;

  /** Outgoing mail: the transport url, the default sender and the link base. */
  mail?: MailOptions;

  /**
   * The application's public origin, e.g. `https://example.com`. Release
   * native builds bake it, `mail.baseUrl` defaults to it, and `FLYPATH_URL`
   * overrides it at build time.
   */
  url?: string;

  /** How `flypath start` runs the built application. */
  serve?: ServeOptions;

  /** User-facing name for the application. */
  appName?: string;

  /** User-facing version identifier. */
  version?: string;

  /**
   * Internal version number for published apps. Required by app stores to be
   * set.
   *
   * Maps to `CFBundleVersion` on iOS and `versionCode` on Android.
   */
  buildNumber?: number;

  /**
   * Unique identifier for the app. Required by app stores to be set.
   *
   * Must follow a stricter reverse-DNS format: two or more period-separated (.)
   * segments, each starting with a letter and containing only alphanumeric
   * characters (A-Z, a-z, 0-9). No segment may be a Kotlin or Java keyword.
   * E.g. `com.example.myapp`
   *
   * Maps to `CFBundleIdentifier` on iOS, and to `applicationId`, `namespace`
   * and the Kotlin package name on Android.
   */
  bundleId?: string;

  ios?: {
    bundleId?: string;
    minimumVersion?: string;
    orientations?: Orientation[];
    teamId?: string;
    distribution?: "app-store" | "ad-hoc" | "development" | "enterprise";
  };

  android?: {
    applicationId?: string;
    minSdk?: number;
  };
};

// We cheat here by not using vite's `loadConfigFromFile` to load flypath's
// configuration options from `vite.config.ts`. Using a plain import that
// doesn't load vite makes cli commands that don't require it (like `migrate`,
// `rollback`, `ios`, ...) much faster.

type Named = { name?: string; api?: unknown };

function isThenable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function collectSettled(option: unknown, out: Named[]): void {
  if (!option || isThenable(option)) return;
  if (Array.isArray(option)) {
    for (const entry of option) collectSettled(entry, out);
    return;
  }
  out.push(option as Named);
}

type Configish = { plugins?: unknown; server?: { port?: number } };

const CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
];

const CONFIG_ENV = { command: "build" as const, mode: "production" };

async function importConfig(root: string): Promise<Configish | undefined> {
  const file = CONFIG_FILES.map((name) => path.join(root, name)).find((entry) =>
    fs.existsSync(entry),
  );
  if (file === undefined) return undefined;

  let exported: unknown;
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    exported = await module.default;
  } catch (error) {
    throw new FlypathError(`Could not load ${path.relative(root, file)}`, {
      hint:
        "flypath runs it with Node, so it cannot use __dirname, require(), " +
        "or TypeScript that emits code (enum, namespace, parameter " +
        "properties).\nUse import.meta.dirname and plain type syntax instead",
      cause: error,
    });
  }

  const config: unknown =
    typeof exported === "function"
      ? await (exported as (env: typeof CONFIG_ENV) => unknown)(CONFIG_ENV)
      : exported;
  return (config ?? undefined) as Configish | undefined;
}

export async function loadOptions(
  root: string,
): Promise<FlypathOptions & { port: number }> {
  const loaded = await importConfig(root);
  if (!loaded) return { port: DEFAULT_PORT };

  const plugins: Named[] = [];
  collectSettled(loaded.plugins, plugins);
  const plugin = plugins.find((entry) => entry.name === CONFIG_PLUGIN);
  return {
    ...(plugin?.api as FlypathOptions | undefined),
    port: loaded.server?.port ?? DEFAULT_PORT,
  };
}
