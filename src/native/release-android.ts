import fs from "node:fs";
import path from "node:path";

import { androidSigning, ENV } from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
import { note, step, success } from "../terminal/output.ts";
import { size } from "../terminal/style.ts";
import type { AndroidOptions } from "./android.ts";
import { generating, gradle, prepareAndroid } from "./android.ts";
import { BUNDLE_NAMES } from "./bundle.ts";
import { loadOptions } from "./config.ts";
import { showWarnings } from "./diagnostics.ts";
import { nativeDir } from "./scaffold.ts";
import { projectContext } from "./template.ts";

const KEYS = ["storeFile", "storePassword", "keyAlias", "keyPassword"];

export function keystoreMissing(root: string): string {
  const file = path.join(nativeDir(root, "android"), "keystore.properties");
  return [
    `Write ${path.relative(root, file)} with these four keys:`,
    ...KEYS.map((key) => `  ${key}=…`),
    "",
    "Create a store with:",
    "  keytool -genkeypair -v -keystore release.keystore -alias release \\",
    "    -keyalg RSA -keysize 2048 -validity 10000",
    "",
    "Or pass them in the environment as " +
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
    throw new FlypathError(`${path.relative(root, bundle)} does not exist`, {
      hint:
        "Run flypath build --platform android first, so the app ships the " +
        "JavaScript the server was built with",
    });
  }
  return bundle;
}

export async function releaseAndroid(
  options: AndroidOptions = {},
): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const bundle = requireBundle(root);

  if (!hasSigning(root)) {
    throw new FlypathError("A release build has to be signed", {
      details: keystoreMissing(root).split("\n"),
    });
  }

  const context = projectContext(root, configured.port, configured);
  const prepared = await step(generating(), () =>
    prepareAndroid(root, context),
  );

  const assets = path.join(prepared.target, "app", "src", "main", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(bundle, path.join(assets, BUNDLE_NAMES.android));

  const apk = options.apk === true;
  const kind = apk ? "APK" : "bundle";
  const build = await step(
    {
      active: `Building the release ${kind}`,
      done: `Built the release ${kind}`,
      failed: "Release build failed",
    },
    (progress) =>
      gradle(
        root,
        prepared.target,
        [apk ? "assembleRelease" : "bundleRelease"],
        {
          progress,
        },
      ),
  );
  showWarnings(root, build);

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });

  const outputs = path.join(
    prepared.target,
    "app",
    "build",
    "outputs",
    apk ? "apk" : "bundle",
    "release",
  );

  const produced = fs
    .readdirSync(outputs)
    .filter((entry) => entry.endsWith(apk ? ".apk" : ".aab"));

  for (const entry of produced) {
    const target = path.join(dist, entry);
    fs.copyFileSync(path.join(outputs, entry), target);
    success(`Wrote dist/${entry}`, size(fs.statSync(target).size));
  }

  const first = produced[0];
  if (first === undefined) return;
  note(
    apk
      ? `Install it with adb install -r dist/${first}`
      : "Upload it in Play Console, or automate that with fastlane supply",
  );
}
