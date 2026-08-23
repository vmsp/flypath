import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot: string = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);

export const templatesDir: string = path.join(packageRoot, "templates");

export type ProjectContext = {
  root: string;
  appName: string;
  bundleId: string;
  androidPackage: string;
  port: number;
  reactNativeRoot: string;
  reactNativeDir: string;
  gradlePluginDir: string;
};

const BINARY = new Set([".png", ".jar", ".keystore", ".jpg", ".webp", ".ttf"]);

function replacements(context: ProjectContext): Array<[string, string]> {
  return [
    ["__FLYPATH_APP_NAME__", context.appName],
    ["__FLYPATH_BUNDLE_ID__", context.bundleId],
    ["__FLYPATH_PACKAGE__", context.androidPackage],
    ["__FLYPATH_PORT__", String(context.port)],
    ["__FLYPATH_PROJECT_ROOT__", context.root],
    ["__FLYPATH_RN_ROOT__", context.reactNativeRoot],
    ["__FLYPATH_RN_DIR__", context.reactNativeDir],
    ["__FLYPATH_GRADLE_PLUGIN_DIR__", context.gradlePluginDir],
  ];
}

function applyAll(value: string, pairs: Array<[string, string]>): string {
  let output = value;
  for (const [from, to] of pairs) output = output.replaceAll(from, to);
  return output;
}

export function materialize(
  templateName: string,
  target: string,
  context: ProjectContext,
): void {
  const source = path.join(templatesDir, templateName);
  const pairs = replacements(context);

  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const child = path.join(from, entry.name);
      const output = path.join(to, entry.name);
      if (entry.isDirectory()) {
        walk(child, output);
        continue;
      }
      if (BINARY.has(path.extname(entry.name))) {
        fs.copyFileSync(child, output);
        continue;
      }
      fs.writeFileSync(output, applyAll(fs.readFileSync(child, "utf8"), pairs));
    }
  };

  walk(source, target);
}

export function projectContext(root: string, port: number): ProjectContext {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { name?: string };
  const rawName = manifest.name ?? path.basename(root);
  const appName = rawName.replace(/[^A-Za-z0-9]/g, "") || "FlypathApp";
  const slug = appName.toLowerCase();

  const resolve = createRequire(path.join(root, "index.js"));
  const packageDir = (name: string): string =>
    path.dirname(resolve.resolve(`${name}/package.json`));

  return {
    root,
    appName,
    bundleId: `dev.flypath.${slug}`,
    androidPackage: `dev.flypath.${slug}`,
    port,
    reactNativeRoot: root,
    reactNativeDir: packageDir("react-native"),
    gradlePluginDir: packageDir("@react-native/gradle-plugin"),
  };
}

export function outputDir(root: string, platform: string): string {
  return path.join(root, "node_modules", ".flypath", platform);
}
