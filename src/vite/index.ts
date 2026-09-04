import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from "vite";

import type { FlypathOptions } from "../native/config.ts";
import { CONFIG_PLUGIN, DEFAULT_PORT } from "../native/config.ts";
import { TAG_DEFAULTS } from "../styles/defaults.ts";
import { flowStrip } from "./flow.ts";
import { metroEndpoints } from "./metro-endpoints.ts";
import {
  NATIVE_PLATFORMS,
  nativeEnvironmentName,
  nativeEnvironmentOptions,
  nativeResolve,
} from "./native-env.ts";
import { nativeModules } from "./native-modules.ts";
import { nativeRefresh } from "./native-refresh.ts";
import { routes } from "./routes.ts";
import { styles } from "./styles.ts";

const distDir = path.dirname(import.meta.dirname);

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

const CLIENT_REFERENCES = "virtual:flypath/client-references";
const CLIENT_REFERENCES_ID = `\0${CLIENT_REFERENCES}`;

function clientReferences(): Plugin {
  const nativeDir = path.join(distDir, "components", "native");

  return {
    name: "flypath:client-references",
    resolveId(source) {
      if (source === CLIENT_REFERENCES) return CLIENT_REFERENCES_ID;
      return undefined;
    },
    load(id) {
      if (id !== CLIENT_REFERENCES_ID) return;

      const files = fs
        .readdirSync(nativeDir)
        .filter((file) => file.endsWith(".js") && file !== "index.js")
        .map((file) => path.join(nativeDir, file));

      const imports = files
        .map(
          (file, index) =>
            `import * as m${index} from ${JSON.stringify(file)};`,
        )
        .join("\n");
      const entries = files
        .map((file, index) => `  ${JSON.stringify(file)}: m${index},`)
        .join("\n");

      return `${imports}\nexport const registry = {\n${entries}\n};\n`;
    },
  };
}

const DATABASE = "virtual:flypath/database";
const DATABASE_ID = `\0${DATABASE}`;

function database(options: FlypathOptions): Plugin {
  let root = process.cwd();

  return {
    name: "flypath:database",
    configResolved(config) {
      root = config.root;
    },
    resolveId(source) {
      if (source === DATABASE) return DATABASE_ID;
      return undefined;
    },
    load(id) {
      if (id !== DATABASE_ID) return;
      const configModule = path.join(distDir, "db", "config.js");
      const lines = [
        `import { configureDatabases } from ${JSON.stringify(configModule)};`,
        `configureDatabases(${JSON.stringify(options.databases ?? {})});`,
      ];
      const schema = path.join(root, "db", "schema.ts");
      if (fs.existsSync(schema)) {
        lines.unshift(`import ${JSON.stringify(schema)};`);
      }
      return lines.join("\n") + "\n";
    },
  };
}

const STUB_ID = "\0flypath:native-stub";

const STUB_EXPORTS = ["BranchesHost", "StackHost"];

function nativeStub(): Plugin {
  const nativeDir = path.join(distDir, "components", "native") + path.sep;

  return {
    name: "flypath:native-stub",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const env = this.environment?.name;
      if (env !== "client" && env !== "ssr") return;
      const resolved = await this.resolve(source, importer, options);
      if (!resolved) return;
      if (!resolved.id.startsWith(nativeDir)) return;
      return STUB_ID;
    },
    load(id) {
      if (id !== STUB_ID) return;
      const names = [
        ...Object.keys(TAG_DEFAULTS).map(
          (tag) => `${tag[0]?.toUpperCase() ?? ""}${tag.slice(1)}`,
        ),
        ...STUB_EXPORTS,
      ];
      return [
        "function FlypathNativeStub() { return null; }",
        "export default FlypathNativeStub;",
        "export const nativeIntrinsics = {};",
        ...names.map((name) => `export const ${name} = FlypathNativeStub;`),
      ].join("\n");
    },
  };
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
  const entry = (name: string) => path.join(distDir, "runtime", name);

  return [
    flypathConfig(options),
    database(options),
    nativeStub(),
    clientReferences(),
    routes(),
    ...nativeModules(distDir),
    ...NATIVE_PLATFORMS.map((platform) =>
      nativeResolve(distDir, platform, () => resolvedRoot),
    ),
    ...styles(distDir),
    nativeRefresh(),
    flowStrip(),
    metroEndpoints(distDir),
    react({ jsxImportSource: "flypath" }),
    rsc({
      entries: {
        rsc: entry("server-entry.js"),
        ssr: entry("ssr-entry.js"),
        client: entry("web-entry.js"),
      },
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
