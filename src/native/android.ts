import fs from "node:fs";
import path from "node:path";

import * as env from "../shared/env.ts";
import { packageRoot } from "../shared/paths.ts";
import type { Progress } from "../terminal/output.ts";
import { step, warn } from "../terminal/output.ts";
import { loadOptions } from "./config.ts";
import { devServerRunning } from "./dev-server.ts";
import { androidHome, tool } from "./device.ts";
import type { Collector } from "./diagnostics.ts";
import { collector, showWarnings } from "./diagnostics.ts";
import { run, startLog } from "./exec.ts";
import { generateAndroidRegistry } from "./generate-cpp.ts";
import { generateCxxAdapters } from "./generate-cxx.ts";
import { link, list } from "./link.ts";
import { componentName } from "./manifest.ts";
import { cxxSources, scaffoldAndroid, scaffoldNative } from "./scaffold.ts";
import type { ProjectContext } from "./template.ts";
import { materialize, outputDir, projectContext } from "./template.ts";

export type AndroidOptions = {
  port?: number;
  root?: string;
  device?: string;
  host?: string;
  release?: boolean;
  apk?: boolean;
  studio?: boolean;
};

// TODO: Add support for finding ANDROID_HOME and JAVA_HOME on Linux and
// Windows.

const JAVA_CANDIDATES = [
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
];

function javaHome(): string | undefined {
  const configured = env.javaHome();
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

export type PreparedAndroid = {
  target: string;
  context: ProjectContext;
};

export async function prepareAndroid(
  root: string,
  context: ProjectContext,
): Promise<PreparedAndroid> {
  const target = outputDir(root, "android");

  scaffoldAndroid(context);
  const manifest = scaffoldNative(context);
  const cxx = manifest.modules.filter((module) => module.cpp !== undefined);

  fs.rmSync(target, { recursive: true, force: true });
  const known = new Set(["localhost", "127.0.0.1", "10.0.2.2", "10.0.3.2"]);
  materialize("android", target, context, [
    ["__FLYPATH_APP_GRADLE__", overlay(context, "app.gradle.kts")],
    [
      "__FLYPATH_DEV_HOST_DOMAIN__",
      known.has(context.devHost)
        ? ""
        : `    <domain includeSubdomains="false">${context.devHost}</domain>`,
    ],
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

  return { target, context };
}

export async function gradle(
  root: string,
  target: string,
  tasks: string[],
  options: { progress?: Progress; serial?: string } = {},
): Promise<Collector> {
  const build = collector(root, "gradle");
  await run(path.join(target, "gradlew"), ["--console=plain", ...tasks], {
    cwd: target,
    env: {
      ...javaEnv(),
      ANDROID_HOME: androidHome(),
      ...(options.serial === undefined
        ? {}
        : { ANDROID_SERIAL: options.serial }),
    },
    onLine: (line) => {
      const label = build.feed(line);
      if (label !== undefined) options.progress?.status(label);
    },
    failure: (output) => build.failure(output),
  });
  return build;
}

export function generating(): { active: string; done: string } {
  return {
    active: "Generating the Gradle project",
    done: "Generated the Gradle project",
  };
}

export async function runAndroid(options: AndroidOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const port = options.port ?? configured.port;
  startLog(root, "android");

  if (options.release === true) {
    const { releaseAndroid } = await import("./release-android.ts");
    await releaseAndroid({ ...options, root });
    return;
  }

  const { androidTargets, pick, resolveHost } = await import("./device.ts");
  const chosen = pick(await androidTargets(), options.device, undefined);
  const onDevice = chosen.kind === "device";
  const host = onDevice ? resolveHost(options.host) : "localhost";
  const context = projectContext(root, port, configured, host);

  const prepared = await step(generating(), () =>
    prepareAndroid(root, context),
  );

  const build = await step(
    {
      active: `Building for ${chosen.name}`,
      done: `Built for ${chosen.name}`,
      failed: `Build failed for ${chosen.name}`,
    },
    (progress) =>
      gradle(root, prepared.target, ["installDebug"], {
        progress,
        serial: chosen.id,
      }),
  );
  showWarnings(root, build);

  if (!(await devServerRunning(port))) {
    warn(
      `Nothing is listening on http://localhost:${String(port)}`,
      "The app shows a red screen until flypath dev is running",
    );
  }

  let reversed = true;
  await step(
    {
      active: `Launching on ${chosen.name}`,
      done: `Launched on ${chosen.name}`,
    },
    async (progress) => {
      try {
        await run(tool("adb"), [
          "-s",
          chosen.id,
          "reverse",
          `tcp:${String(port)}`,
          `tcp:${String(port)}`,
        ]);
      } catch {
        reversed = false;
      }
      if (!reversed && host !== "localhost") {
        progress.summary(`reaching http://${host}:${String(port)}`);
      }
      await run(tool("adb"), [
        "-s",
        chosen.id,
        "shell",
        "am",
        "start",
        "-n",
        `${context.androidPackage}/${context.androidPackage}.MainActivity`,
      ]);
    },
    { time: false },
  );

  if (!reversed) {
    warn(
      `adb reverse failed on ${chosen.name}`,
      `The app reaches the dev server at http://${host}:${String(port)} instead`,
    );
  }
}
