import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadOptions } from "./config.ts";
import { run } from "./exec.ts";
import { generateAndroidRegistry } from "./generate-cpp.ts";
import { generateCxxAdapters } from "./generate-cxx.ts";
import { link, list } from "./link.ts";
import { componentName } from "./manifest.ts";
import { cxxSources, scaffoldAndroid, scaffoldNative } from "./scaffold.ts";
import type { ProjectContext } from "./template.ts";
import {
  materialize,
  outputDir,
  packageRoot,
  projectContext,
} from "./template.ts";

export type AndroidOptions = {
  port?: number;
  root?: string;
};

// TODO: Add support for finding ANDROID_HOME and JAVA_HOME on Linux and
// Windows.

function androidHome(): string {
  return (
    process.env["ANDROID_HOME"] ??
    process.env["ANDROID_SDK_ROOT"] ??
    path.join(os.homedir(), "Library", "Android", "sdk")
  );
}

const JAVA_CANDIDATES = [
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
];

function javaHome(): string | undefined {
  const configured = process.env["JAVA_HOME"];
  if (configured && fs.existsSync(configured)) return configured;
  return JAVA_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

function javaEnv(): NodeJS.ProcessEnv {
  const home = javaHome();
  if (!home) return {};
  return {
    JAVA_HOME: home,
    PATH: `${path.join(home, "bin")}:${process.env["PATH"] ?? ""}`,
  };
}

function tool(name: string): string {
  const candidate = path.join(androidHome(), "platform-tools", name);
  return fs.existsSync(candidate) ? candidate : name;
}

function movePackageSources(target: string, androidPackage: string): void {
  const base = path.join(target, "app", "src", "main", "kotlin");
  const from = path.join(base, "dev", "flypath", "app");
  const to = path.join(base, ...androidPackage.split("."));
  if (path.resolve(from) === path.resolve(to) || !fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function writeAutolinkingConfig(
  target: string,
  context: { root: string; reactNativeDir: string; androidPackage: string },
): void {
  const dir = path.join(target, "build", "generated", "autolinking");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "autolinking.json"),
    JSON.stringify({
      root: context.root,
      reactNativePath: context.reactNativeDir,
      dependencies: {},
      project: {
        android: {
          sourceDir: target,
          packageName: context.androidPackage,
        },
      },
    }),
  );
}

function linkNativeSources(
  target: string,
  generated: Record<string, string>,
  extra: string[],
): void {
  const jni = path.join(target, "app", "src", "main", "jni");

  for (const file of [
    ...list(path.join(packageRoot, "cpp", "abi", "include"), [".h"]),
    ...list(path.join(packageRoot, "cpp"), [".h", ".cpp"]),
    ...list(path.join(packageRoot, "cpp", "include"), [".h"]),
    ...list(path.join(packageRoot, "android", "jni"), [".h", ".cpp"]),
    ...extra,
  ]) {
    link(file, path.join(jni, path.basename(file)));
  }
  for (const [name, contents] of Object.entries(generated)) {
    fs.writeFileSync(path.join(jni, name), contents);
  }
}

async function ensureKeystore(root: string, target: string): Promise<void> {
  const shared = path.join(root, "node_modules", ".flypath", "debug.keystore");
  const keystore = path.join(target, "app", "debug.keystore");

  if (fs.existsSync(shared)) {
    fs.copyFileSync(shared, keystore);
    return;
  }
  const home = javaHome();
  const keytool = home ? path.join(home, "bin", "keytool") : "keytool";
  await run(
    keytool,
    [
      "-genkeypair",
      "-v",
      "-keystore",
      keystore,
      "-storepass",
      "android",
      "-alias",
      "androiddebugkey",
      "-keypass",
      "android",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-dname",
      "CN=Android Debug,O=Android,C=US",
    ],
    { env: javaEnv() },
  );
}

function overlay(context: ProjectContext, name: string): string {
  const file = path.join(context.root, "android", name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function mergeProperties(context: ProjectContext, target: string): void {
  const extra = overlay(context, "gradle.properties");
  if (extra === "") return;

  const file = path.join(target, "gradle.properties");
  const entries = new Map<string, string>();
  for (const source of [fs.readFileSync(file, "utf8"), extra]) {
    for (const line of source.split("\n")) {
      const at = line.indexOf("=");
      if (at === -1 || line.trimStart().startsWith("#")) continue;
      entries.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  fs.writeFileSync(
    file,
    `${[...entries].map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
  );
}

function ensureWrapper(source: string, target: string): void {
  fs.mkdirSync(path.join(target, "gradle", "wrapper"), { recursive: true });
  for (const file of ["gradle-wrapper.jar", "gradle-wrapper.properties"]) {
    fs.copyFileSync(
      path.join(source, "gradle", "wrapper", file),
      path.join(target, "gradle", "wrapper", file),
    );
  }
  fs.copyFileSync(path.join(source, "gradlew"), path.join(target, "gradlew"));
  fs.chmodSync(path.join(target, "gradlew"), 0o755);
}

export async function runAndroid(options: AndroidOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const port = options.port ?? configured.port ?? 8081;
  const context = projectContext(root, port, configured);
  const target = outputDir(root, "android");

  scaffoldAndroid(context);
  const manifest = scaffoldNative(context);
  const cxx = manifest.modules.filter((module) => module.cpp !== undefined);

  fs.rmSync(target, { recursive: true, force: true });
  materialize("android", target, context, [
    ["__FLYPATH_APP_GRADLE__", overlay(context, "app.gradle.kts")],
    [
      "__FLYPATH_VIEW_NAMES__",
      manifest.modules
        .flatMap((module) =>
          module.components.map((entry) =>
            JSON.stringify(componentName(module.slug, entry.name)),
          ),
        )
        .join(", "),
    ],
  ]);
  movePackageSources(target, context.androidPackage);
  linkNativeSources(
    target,
    {
      "FlypathGenerated.cpp": generateAndroidRegistry(manifest),
      ...(cxx.length === 0
        ? {}
        : { "FlypathCxxAdapters.cpp": generateCxxAdapters(cxx) }),
    },
    cxx.length === 0 ? [] : cxxSources(root),
  );

  fs.writeFileSync(
    path.join(target, "local.properties"),
    `sdk.dir=${androidHome()}\n`,
  );

  mergeProperties(context, target);
  writeAutolinkingConfig(target, context);
  await ensureKeystore(root, target);
  ensureWrapper(context.gradlePluginDir, target);

  await run(path.join(target, "gradlew"), ["installDebug"], {
    cwd: target,
    env: { ...javaEnv(), ANDROID_HOME: androidHome() },
  });

  await run(tool("adb"), ["reverse", `tcp:${port}`, `tcp:${port}`]);
  await run(tool("adb"), [
    "shell",
    "am",
    "start",
    "-n",
    `${context.androidPackage}/${context.androidPackage}.MainActivity`,
  ]);
}
