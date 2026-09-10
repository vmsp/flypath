import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { distDir } from "../shared/paths.ts";
import type { NativeBundle } from "../vite/bundler.ts";
import { NativeBundler } from "../vite/bundler.ts";
import type { NativePlatform } from "../vite/native-env.ts";
import { nativeEnvironmentName } from "../vite/native-env.ts";
import { currentManifest } from "../vite/native-modules.ts";
import { run } from "./exec.ts";

export const BUNDLE_NAMES: Record<NativePlatform, string> = {
  ios: "main.jsbundle",
  android: "index.android.bundle",
};

const POLYFILLS = [
  "@react-native/js-polyfills/console.js",
  "@react-native/js-polyfills/error-guard.js",
  "react-native/Libraries/Core/InitializeCore.js",
];

function nativeEntries(): string[] {
  return [...POLYFILLS, path.join(distDir, "runtime", "native-entry.js")];
}

function runtimeVersions(root: string): string {
  const require = createRequire(path.join(root, "index.js"));
  const read = (name: string): string => {
    try {
      const manifest = require.resolve(`${name}/package.json`);
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
        version?: string;
      };
      return `${name}@${parsed.version ?? "0"}`;
    } catch {
      return `${name}@missing`;
    }
  };
  return [read("react-native"), read("react"), read("flypath")].join(" ");
}

const HERMES_HOSTS: Record<string, string> = {
  darwin: "osx-bin",
  linux: "linux64-bin",
  win32: "win64-bin",
};

function hermesCompiler(root: string): string | undefined {
  const host = HERMES_HOSTS[os.platform()];
  if (host === undefined) return undefined;
  const require = createRequire(path.join(root, "index.js"));
  let reactNative: string;
  try {
    reactNative = path.dirname(require.resolve("react-native/package.json"));
  } catch {
    return undefined;
  }
  try {
    const manifest = createRequire(path.join(reactNative, "index.js")).resolve(
      "hermes-compiler/package.json",
    );
    const binary = path.join(
      path.dirname(manifest),
      "hermesc",
      host,
      os.platform() === "win32" ? "hermesc.exe" : "hermesc",
    );
    return fs.existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

function composeScript(root: string): string | undefined {
  const require = createRequire(path.join(root, "index.js"));
  try {
    const reactNative = path.dirname(
      require.resolve("react-native/package.json"),
    );
    const script = path.join(reactNative, "scripts", "compose-source-maps.js");
    return fs.existsSync(script) ? script : undefined;
  } catch {
    return undefined;
  }
}

type ViteServer = {
  environments: Record<string, unknown>;
  config: { root: string };
  close: () => Promise<void>;
};

async function createNativeServer(root: string): Promise<ViteServer> {
  const { createServer } = await import("vite");
  return (await createServer({
    root,
    mode: "production",
    configFile: undefined,
    logLevel: "warn",
    server: { middlewareMode: true, hmr: false, watch: null },
  })) as unknown as ViteServer;
}

function nativeBundler(
  server: ViteServer,
  platform: NativePlatform,
): NativeBundler {
  const name = nativeEnvironmentName(platform);
  const environment = server.environments[name];
  if (!environment) {
    throw new Error(
      `flypath: the "${name}" environment is missing; flypath's vite plugin ` +
        "must be in vite.config.ts",
    );
  }
  return new NativeBundler(environment as never, server.config.root);
}

type ReleaseBundleOptions = {
  root: string;
  platform: NativePlatform;
  serverUrl: string;
  outDir: string;
  build: string;
  seed?: { entries: string[]; seeded: Record<string, number> };
  hermes?: boolean;
  log?: (message: string) => void;
};

export type ReleaseBundle = {
  platform: NativePlatform;
  bundle: NativeBundle;
  source: string;
  output: string;
  map: string;
  bytecode: boolean;
};

async function buildReleaseBundle(
  bundler: NativeBundler,
  options: ReleaseBundleOptions,
): Promise<ReleaseBundle> {
  const log = options.log ?? ((message: string) => console.log(message));

  const bundle = await bundler.build({
    entries: nativeEntries(),
    platform: options.platform,
    dev: false,
    serverUrl: options.serverUrl,
    manifestHash: currentManifest()?.hash ?? "",
    build: options.build,
    runtimeVersions: runtimeVersions(options.root),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  const name = BUNDLE_NAMES[options.platform];
  const output = path.join(options.outDir, name);
  const source = `${output}.source.js`;
  const packagerMap = `${output}.packager.map`;
  const composed = `${output}.map`;

  fs.writeFileSync(source, bundle.code);
  fs.writeFileSync(packagerMap, JSON.stringify(bundle.map));

  const compiler =
    options.hermes === false ? undefined : hermesCompiler(options.root);
  if (!compiler) {
    fs.copyFileSync(source, output);
    fs.copyFileSync(packagerMap, composed);
    fs.rmSync(packagerMap, { force: true });
    log(
      `flypath: ${options.platform} — hermesc was not found; shipping the ` +
        "source bundle instead of bytecode",
    );
    return {
      platform: options.platform,
      bundle,
      source,
      output,
      map: composed,
      bytecode: false,
    };
  }

  const compilerMap = `${output}.hbc.map`;
  await run(compiler, [
    "-emit-binary",
    "-O",
    "-output-source-map",
    "-out",
    output,
    source,
  ]);

  const script = composeScript(options.root);
  if (script && fs.existsSync(compilerMap)) {
    await run(process.execPath, [
      script,
      packagerMap,
      compilerMap,
      "-o",
      composed,
    ]);
    fs.rmSync(compilerMap, { force: true });
  } else {
    fs.copyFileSync(packagerMap, composed);
  }
  fs.rmSync(packagerMap, { force: true });

  const size = fs.statSync(output).size;
  log(
    `flypath: ${options.platform} — ${name} is ${String(
      Math.round(size / 1024),
    )} kB of Hermes bytecode (baseId ${bundle.baseId})`,
  );

  return {
    platform: options.platform,
    bundle,
    source,
    output,
    map: composed,
    bytecode: true,
  };
}

export type NativeReleaseOptions = {
  root: string;
  platforms: readonly NativePlatform[];
  url: string;
  build: string;
  outDir: string;
  clientDir: string;
  rscDir: string;
  hermes?: boolean;
  log?: (message: string) => void;
};

export async function buildNativeRelease(
  options: NativeReleaseOptions,
): Promise<ReleaseBundle[]> {
  const log = options.log ?? ((message: string) => console.log(message));
  const {
    buildChunks,
    chunkManifest,
    resolveReferences,
    writeChunkManifest,
    writeChunks,
  } = await import("./chunks.ts");

  const references = resolveReferences(options.root, options.rscDir);
  const server = await createNativeServer(options.root);
  const out: ReleaseBundle[] = [];

  try {
    for (const platform of options.platforms) {
      const bundler = nativeBundler(server, platform);

      const base = await bundler.build({
        entries: nativeEntries(),
        platform,
        dev: false,
        serverUrl: options.url,
        manifestHash: currentManifest()?.hash ?? "",
        build: options.build,
        runtimeVersions: runtimeVersions(options.root),
      });

      const set = await buildChunks(bundler, references);
      writeChunks(options.clientDir, platform, set.chunks);
      log(
        `flypath: ${platform} — ${String(set.chunks.length)} client chunks ` +
          `(${String(set.chunks.filter((chunk) => chunk.empty).length)} already in the base)`,
      );

      const release = await buildReleaseBundle(bundler, {
        root: options.root,
        platform,
        serverUrl: options.url,
        outDir: path.join(options.outDir, platform),
        build: options.build,
        seed: { entries: set.entries, seeded: set.seeded },
        ...(options.hermes === undefined ? {} : { hermes: options.hermes }),
        log,
      });

      if (release.bundle.baseId !== base.baseId) {
        throw new Error(
          "flypath: the base bundle's module set changed between the chunk " +
            "pass and the seeded pass, so baseId is not reproducible",
        );
      }

      const file = writeChunkManifest(
        options.clientDir,
        platform,
        chunkManifest(base.baseId, options.build, set.chunks),
      );
      log(`flypath: ${platform} — wrote ${path.relative(options.root, file)}`);

      out.push(release);
    }
  } finally {
    await server.close();
  }

  return out;
}
