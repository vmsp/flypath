import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { transformAsync } from "@babel/core";
import type { Plugin } from "vite";

const FLOW_PACKAGES = [
  "react-native",
  "@react-native/",
  "react-native-",
  "@react-native-",
];

const localRequire = createRequire(import.meta.url);

const SYNTAX_HERMES = localRequire.resolve("babel-plugin-syntax-hermes-parser");
const PRESET_FLOW = localRequire.resolve("@babel/preset-flow");
const PRESET_REACT = localRequire.resolve("@babel/preset-react");
const CODEGEN = localRequire.resolve("@react-native/babel-plugin-codegen");

export function needsFlowStrip(id: string): boolean {
  if (!id.endsWith(".js") && !id.endsWith(".jsx")) return false;
  const parts = id.split("node_modules/");
  const tail = parts[parts.length - 1];
  if (tail === undefined || parts.length === 1) return false;
  return FLOW_PACKAGES.some((pkg) => tail.startsWith(pkg));
}

function cacheKey(id: string, code: string): string {
  return createHash("sha1").update(id).update("\0").update(code).digest("hex");
}

export function flowStrip(): Plugin {
  let dir = "";
  let ready = false;

  return {
    name: "flypath:flow-strip",
    enforce: "pre",
    applyToEnvironment(environment) {
      return environment.name.startsWith("native_");
    },
    configResolved(config) {
      dir = path.join(config.root, "node_modules", ".flypath", "flow");
    },
    async transform(code, id) {
      if (!needsFlowStrip(id)) return;

      if (!ready) {
        fs.mkdirSync(dir, { recursive: true });
        ready = true;
      }

      const file = path.join(dir, `${cacheKey(id, code)}.json`);
      try {
        const cached = fs.readFileSync(file, "utf8");
        return JSON.parse(cached) as { code: string; map: null };
      } catch {
        // not cached yet
      }

      const result = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        browserslistConfigFile: false,
        compact: false,
        sourceMaps: true,
        sourceType: "unambiguous",
        plugins: [[SYNTAX_HERMES, { parseLangTypes: "flow" }], CODEGEN],
        presets: [
          [PRESET_FLOW, { allowDeclareFields: true }],
          [PRESET_REACT, { runtime: "automatic" }],
        ],
      });

      if (!result?.code) return;

      const output = { code: result.code, map: result.map ?? null };
      fs.writeFileSync(file, JSON.stringify(output));
      return output;
    },
  };
}
