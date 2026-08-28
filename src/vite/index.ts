import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import type { Plugin, PluginOption } from "vite";

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

const distDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export type FlypathOptions = {
  port?: number;
};

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

const STUB_ID = "\0flypath:native-stub";

const STUB_EXPORTS = ["NativeNavigator", "NativeTabBar"];

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

function flypathConfig(port: number): Plugin {
  return {
    name: "flypath:config",
    configResolved(config) {
      resolvedRoot = config.root;
    },
    config(_userConfig, env) {
      return {
        appType: "custom" as const,
        server: { host: true, port, strictPort: true },
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

export function flypath(options: FlypathOptions = {}): PluginOption[] {
  const port = options.port ?? 8081;
  const entry = (name: string) => path.join(distDir, "runtime", name);

  return [
    flypathConfig(port),
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
