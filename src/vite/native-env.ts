import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EnvironmentOptions, Plugin } from "vite";

import type { Platform } from "../runtime/platform.ts";

export type NativePlatform = "ios" | "android";

export const NATIVE_PLATFORMS: NativePlatform[] = ["ios", "android"];

export function nativeEnvironmentName(platform: NativePlatform): string {
  return `native_${platform}`;
}

export function isNativePlatform(value: Platform): value is NativePlatform {
  return value === "ios" || value === "android";
}

const BASE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".json"];

function extensionsFor(platform: NativePlatform): string[] {
  return [
    ...BASE_EXTENSIONS.map((extension) => `.${platform}${extension}`),
    ...BASE_EXTENSIONS.map((extension) => `.native${extension}`),
    ...BASE_EXTENSIONS,
  ];
}

export function nativeEnvironmentOptions(
  platform: NativePlatform,
): EnvironmentOptions {
  return {
    consumer: "server",
    keepProcessEnv: false,
    define: {
      __DEV__: "globalThis.__DEV__",
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    resolve: {
      extensions: extensionsFor(platform),
      conditions: ["react-native", "require", "default"],
      externalConditions: [],
      mainFields: ["react-native", "main", "module"],
      dedupe: ["react", "react-native"],
      external: [],
      noExternal: true,
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    dev: {
      moduleRunnerTransform: true,
    },
    build: {
      target: "esnext",
    },
  };
}

const REACT_DOM_STUB = "\0flypath:react-dom-stub";

function probe(candidate: string, extensions: string[]): string | undefined {
  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    // keep probing
  }
  for (const extension of extensions) {
    const file = candidate + extension;
    if (fs.existsSync(file)) return file;
  }
  for (const extension of extensions) {
    const file = path.join(candidate, `index${extension}`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

const DEEP_IMPORT_PACKAGES = ["react-native/", "@react-native/"];

function packageName(source: string): string {
  const parts = source.split("/");
  return source.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? "");
}

function deepImport(
  source: string,
  importer: string | undefined,
  root: string,
  extensions: string[],
): string | undefined {
  if (!DEEP_IMPORT_PACKAGES.some((prefix) => source.startsWith(prefix))) {
    return undefined;
  }
  const name = packageName(source);
  const subpath = source.slice(name.length + 1);
  if (subpath === "" || subpath === "package.json") return undefined;

  const from = importer ?? path.join(root, "index.js");
  try {
    const manifest = createRequire(from).resolve(`${name}/package.json`);
    return probe(path.join(path.dirname(manifest), subpath), extensions);
  } catch {
    return undefined;
  }
}

const RSC_SSR_SHIM = /[\\/]plugin-rsc[\\/]dist[\\/]react[\\/]ssr\.js$/;

function browserShim(source: string): string | undefined {
  const file = source.startsWith("file:") ? fileURLToPath(source) : source;
  if (!RSC_SSR_SHIM.test(file)) return undefined;
  return file.replace(/ssr\.js$/, "browser.js");
}

export function nativeResolve(
  distDir: string,
  platform: NativePlatform,
  root: () => string,
): Plugin {
  const webOnly = new Set([
    "react-dom",
    "react-dom/client",
    "react-dom/server",
  ]);
  const extensions = extensionsFor(platform);

  return {
    name: "flypath:native-resolve",
    enforce: "pre",
    applyToEnvironment(environment) {
      return environment.name === nativeEnvironmentName(platform);
    },
    resolveId(source, importer) {
      if (webOnly.has(source)) return REACT_DOM_STUB;
      const shim = browserShim(source);
      if (shim) return shim;
      if (source === "flypath/native") {
        return path.join(distDir, "components", "native", "index.js");
      }
      if (
        importer !== undefined &&
        importer.includes(`${path.sep}node_modules${path.sep}`) &&
        (source.startsWith("./") || source.startsWith("../"))
      ) {
        return probe(path.resolve(path.dirname(importer), source), extensions);
      }
      return deepImport(source, importer, root(), extensions);
    },
    load(id) {
      if (id !== REACT_DOM_STUB) return;
      const formStatus = path.join(
        distDir,
        "components",
        "native",
        "form-status.js",
      );
      return [
        `export { useFormStatus } from ${JSON.stringify(formStatus)};`,
        "export const createPortal = () => null;",
        "export default {};",
        "",
      ].join("\n");
    },
  };
}
