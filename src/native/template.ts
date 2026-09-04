import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { FlypathOptions, Orientation } from "./config.ts";

export const packageRoot: string = path.dirname(
  path.dirname(import.meta.dirname),
);

const templatesDir: string = path.join(packageRoot, "templates");

export type ProjectContext = {
  root: string;
  appName: string;
  projectName: string;
  bundleId: string;
  androidPackage: string;
  version: string;
  build: number;
  minSdk: number;
  deploymentTarget: string;
  orientations: Orientation[];
  port: number;
  reactNativeRoot: string;
  reactNativeDir: string;
  gradlePluginDir: string;
};

const BINARY = new Set([".png", ".jar", ".keystore", ".jpg", ".webp", ".ttf"]);

const IOS_ORIENTATIONS: Record<Orientation, string> = {
  portrait: "UIInterfaceOrientationPortrait",
  portraitUpsideDown: "UIInterfaceOrientationPortraitUpsideDown",
  landscapeLeft: "UIInterfaceOrientationLandscapeLeft",
  landscapeRight: "UIInterfaceOrientationLandscapeRight",
};

const DEFAULT_ORIENTATIONS: Orientation[] = [
  "portrait",
  "landscapeLeft",
  "landscapeRight",
];

export function iosOrientations(context: ProjectContext): string[] {
  return context.orientations.map((entry) => IOS_ORIENTATIONS[entry]);
}

function androidOrientation(context: ProjectContext): string {
  const portrait = context.orientations.some((entry) =>
    entry.startsWith("portrait"),
  );
  const landscape = context.orientations.some((entry) =>
    entry.startsWith("landscape"),
  );
  if (portrait && !landscape) return "portrait";
  if (landscape && !portrait) return "landscape";
  return "unspecified";
}

function replacements(context: ProjectContext): Array<[string, string]> {
  return [
    ["__FLYPATH_APP_NAME__", context.appName],
    ["__FLYPATH_PROJECT_NAME__", context.projectName],
    ["__FLYPATH_BUNDLE_ID__", context.bundleId],
    ["__FLYPATH_PACKAGE__", context.androidPackage],
    ["__FLYPATH_VERSION__", context.version],
    ["__FLYPATH_BUILD__", String(context.build)],
    ["__FLYPATH_MIN_SDK__", String(context.minSdk)],
    ["__FLYPATH_DEPLOYMENT_TARGET__", context.deploymentTarget],
    ["__FLYPATH_ORIENTATION__", androidOrientation(context)],
    ["__FLYPATH_PORT__", String(context.port)],
    ["__FLYPATH_PROJECT_ROOT__", context.root],
    ["__FLYPATH_NATIVE_DIR__", path.join(context.root, "android")],
    ["__FLYPATH_RN_ROOT__", context.reactNativeRoot],
    ["__FLYPATH_RN_DIR__", context.reactNativeDir],
    ["__FLYPATH_GRADLE_PLUGIN_DIR__", context.gradlePluginDir],
    ["__FLYPATH_ANDROID_DIR__", path.join(packageRoot, "android")],
  ];
}

function applyAll(value: string, pairs: Array<[string, string]>): string {
  let output = value;
  for (const [from, to] of pairs) output = output.replaceAll(from, to);
  return output;
}

function copyTree(
  source: string,
  target: string,
  pairs: Array<[string, string]>,
  overwrite: boolean,
): void {
  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const child = path.join(from, entry.name);
      const output = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(child, output);
        continue;
      }
      if (!overwrite && fs.existsSync(output)) continue;
      if (BINARY.has(path.extname(entry.name))) {
        fs.copyFileSync(child, output);
        continue;
      }
      fs.writeFileSync(output, applyAll(fs.readFileSync(child, "utf8"), pairs));
    }
  };

  walk(source, target);
}

export function materialize(
  templateName: string,
  target: string,
  context: ProjectContext,
  extra: Array<[string, string]> = [],
): void {
  copyTree(
    path.join(templatesDir, templateName),
    target,
    [...replacements(context), ...extra],
    true,
  );
}

export function scaffoldTemplate(
  templateName: string,
  target: string,
  context: ProjectContext,
  extra: Array<[string, string]> = [],
): void {
  copyTree(
    path.join(templatesDir, "scaffold", templateName),
    target,
    [...replacements(context), ...extra],
    false,
  );
}

function marketingVersion(value: string | undefined): string {
  const match = value?.match(/^\d+(?:\.\d+){0,2}/);
  return match?.[0] ?? "1.0";
}

export function projectContext(
  root: string,
  port: number,
  options: FlypathOptions = {},
): ProjectContext {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  const rawName = manifest.name ?? path.basename(root);
  const projectName = rawName.replace(/[^A-Za-z0-9]/g, "") || "FlypathApp";
  const slug = projectName.toLowerCase();
  const bundleId = options.bundleId ?? `dev.flypath.${slug}`;

  const packageDir = (name: string, from: string): string =>
    path.dirname(createRequire(from).resolve(`${name}/package.json`));

  const reactNativeDir = packageDir(
    "react-native",
    path.join(root, "index.js"),
  );

  return {
    root,
    appName: options.appName ?? projectName,
    projectName,
    bundleId: options.ios?.bundleId ?? bundleId,
    androidPackage: options.android?.applicationId ?? bundleId,
    version: options.version ?? marketingVersion(manifest.version),
    build: options.buildNumber ?? 1,
    minSdk: options.android?.minSdk ?? 24,
    deploymentTarget: options.ios?.minimumVersion ?? "16.0",
    orientations: options.ios?.orientations ?? DEFAULT_ORIENTATIONS,
    port,
    reactNativeRoot: root,
    reactNativeDir,
    gradlePluginDir: packageDir(
      "@react-native/gradle-plugin",
      path.join(reactNativeDir, "package.json"),
    ),
  };
}

export function outputDir(root: string, platform: string): string {
  return path.join(root, "node_modules", ".flypath", platform);
}
