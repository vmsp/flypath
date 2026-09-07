import path from "node:path";

import type { ConfigEnv, Plugin, PluginOption, UserConfig } from "vite";

import type { FlypathOptions } from "../native/config.ts";
import { CONFIG_PLUGIN, DEFAULT_PORT } from "../native/config.ts";
import { distDir } from "../shared/paths.ts";
import {
  NATIVE_PLATFORMS,
  nativeEnvironmentName,
  nativeEnvironmentOptions,
} from "./native-env.ts";

export type { JobsOptions, QueueOptions } from "../jobs/config.ts";
export type { FlypathOptions } from "../native/config.ts";

export function flypathPaths(): {
  distDir: string;
  runtimeDir: string;
  componentsDir: string;
} {
  return {
    distDir,
    runtimeDir: path.join(distDir, "runtime"),
    componentsDir: path.join(distDir, "components"),
  };
}

function lazyPlugin(load: () => Promise<PluginOption>): PluginOption {
  let pending: Promise<PluginOption> | undefined;
  return {
    then: (
      resolve: (value: PluginOption) => unknown,
      reject: (reason: unknown) => unknown,
    ) => (pending ??= load()).then(resolve, reject),
  } as unknown as PluginOption;
}

let resolvedRoot = process.cwd();

function flypathConfig(options: FlypathOptions): Plugin {
  return {
    name: CONFIG_PLUGIN,
    api: options,
    configResolved(config) {
      resolvedRoot = config.root;
    },
    config(userConfig, env) {
      return {
        appType: "custom" as const,
        server: {
          host: true,
          port: userConfig.server?.port ?? DEFAULT_PORT,
          strictPort: true,
        },
        oxc: { jsx: { importSource: "flypath" } },
        environments:
          env.command === "serve"
            ? Object.fromEntries(
                NATIVE_PLATFORMS.map((platform) => [
                  nativeEnvironmentName(platform),
                  nativeEnvironmentOptions(platform),
                ]),
              )
            : {},
      };
    },
  };
}

/**
 * Flypath's Vite plugins. Only needed to compose flypath into an existing Vite
 * config; `defineConfig` already includes them.
 */
export function flypath(options: FlypathOptions = {}): PluginOption[] {
  return [
    flypathConfig(options),
    lazyPlugin(async () => {
      const { plugins } = await import("./plugins.ts");
      return plugins(options, () => resolvedRoot);
    }),
  ];
}

export type FlypathConfig = UserConfig & FlypathOptions;

type FlypathConfigExport =
  | FlypathConfig
  | Promise<FlypathConfig>
  | ((env: ConfigEnv) => FlypathConfig | Promise<FlypathConfig>);

function withFlypath(config: FlypathConfig): UserConfig {
  const {
    appName,
    version,
    buildNumber,
    bundleId,
    databases,
    jobs,
    ios,
    android,
    ...vite
  } = config;

  return {
    ...vite,
    plugins: [
      flypath({
        appName,
        version,
        buildNumber,
        bundleId,
        databases,
        jobs,
        ios,
        android,
      }),
      vite.plugins,
    ],
  };
}

/**
 * Configuration helper to use in `vite.config.ts`. Automatically adds all
 * options and plugins needed by flypath.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "flypath/vite";
 *
 * export default defineConfig({
 *   appName: "Example",
 *   version: "2.1",
 *   buildNumber: 8,
 * });
 * ```
 */
export function defineConfig(config: FlypathConfig): UserConfig;
export function defineConfig(
  config: Promise<FlypathConfig>,
): Promise<UserConfig>;
export function defineConfig(
  config: (env: ConfigEnv) => FlypathConfig | Promise<FlypathConfig>,
): (env: ConfigEnv) => Promise<UserConfig>;
export function defineConfig(
  config: FlypathConfigExport,
):
  | UserConfig
  | Promise<UserConfig>
  | ((env: ConfigEnv) => Promise<UserConfig>) {
  if (typeof config === "function") {
    return async (env: ConfigEnv) => withFlypath(await config(env));
  }
  if (config instanceof Promise) return config.then(withFlypath);
  return withFlypath(config);
}
