import fs from "node:fs";
import path from "node:path";

import { androidSigning, ENV } from "../shared/env.ts";
import type { AndroidOptions } from "./android.ts";
import { gradle, prepareAndroid } from "./android.ts";
import { BUNDLE_NAMES } from "./bundle.ts";
import { loadOptions } from "./config.ts";
import { nativeDir } from "./scaffold.ts";
import { projectContext } from "./template.ts";

const KEYS = ["storeFile", "storePassword", "keyAlias", "keyPassword"];

export function keystoreMissing(root: string): string {
  const file = path.join(nativeDir(root, "android"), "keystore.properties");
  return [
    `flypath: a release build has to be signed, and ${path.relative(root, file)}`,
    "is missing. Write it with these four keys:",
    ...KEYS.map((key) => `  ${key}=…`),
    "",
    "  create a store with:",
    "    keytool -genkeypair -v -keystore release.keystore -alias release \\",
    "      -keyalg RSA -keysize 2048 -validity 10000",
    "",
    "  or pass them in the environment as " +
      KEYS.map((key) => `${ENV.androidSigning}${key.toUpperCase()}`).join(", "),
  ].join("\n");
}

export function hasSigning(root: string): boolean {
  if (androidSigning("storeFile") !== undefined) return true;
  const file = path.join(nativeDir(root, "android"), "keystore.properties");
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  return KEYS.every((key) => new RegExp(`^\\s*${key}\\s*=`, "m").test(text));
}

function requireBundle(root: string): string {
  const bundle = path.join(
    root,
    "dist",
    "native",
    "android",
    BUNDLE_NAMES.android,
  );
  if (!fs.existsSync(bundle)) {
    throw new Error(
      `flypath: ${path.relative(root, bundle)} does not exist — run ` +
        "`flypath build --platform android` first, so the app ships the same " +
        "JavaScript the server was built with",
    );
  }
  return bundle;
}

export async function releaseAndroid(
  options: AndroidOptions = {},
): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const bundle = requireBundle(root);

  if (!hasSigning(root)) throw new Error(keystoreMissing(root));

  const context = projectContext(root, configured.port, configured);
  const prepared = await prepareAndroid(root, context);

  const assets = path.join(prepared.target, "app", "src", "main", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(bundle, path.join(assets, BUNDLE_NAMES.android));

  const task = options.apk === true ? "assembleRelease" : "bundleRelease";
  await gradle(prepared.target, [task]);

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });

  const outputs = path.join(
    prepared.target,
    "app",
    "build",
    "outputs",
    options.apk === true ? "apk" : "bundle",
    "release",
  );

  const produced = fs
    .readdirSync(outputs)
    .filter((entry) => entry.endsWith(options.apk === true ? ".apk" : ".aab"));

  for (const entry of produced) {
    fs.copyFileSync(path.join(outputs, entry), path.join(dist, entry));
    console.log(`flypath: wrote dist/${entry}`);
  }

  if (options.apk === true) {
    console.log(
      "flypath: install it with `adb install -r dist/app-release.apk`",
    );
    return;
  }

  console.log(
    [
      "flypath: upload the .aab to Play Console, or automate it with the Play",
      "  Developer API — `fastlane supply` and `bundletool` are the usual",
      "  routes; flypath does not upload for you",
    ].join("\n"),
  );
}
