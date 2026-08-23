import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { run } from "./exec.ts";
import { materialize, outputDir, projectContext } from "./template.ts";

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

function ensureWrapper(root: string, target: string): void {
  const source = path.dirname(
    createRequire(path.join(root, "index.js")).resolve(
      "@react-native/gradle-plugin/package.json",
    ),
  );

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
  const port = options.port ?? 8081;
  const context = projectContext(root, port);
  const target = outputDir(root, "android");

  fs.rmSync(target, { recursive: true, force: true });
  materialize("android", target, context);
  movePackageSources(target, context.androidPackage);

  fs.writeFileSync(
    path.join(target, "local.properties"),
    `sdk.dir=${androidHome()}\n`,
  );

  writeAutolinkingConfig(target, context);
  await ensureKeystore(root, target);
  ensureWrapper(root, target);

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
