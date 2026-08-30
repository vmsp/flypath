import fs from "node:fs";
import path from "node:path";

import { run } from "./exec.ts";
import { clangdConfig, generateCxxHeader } from "./generate-cxx.ts";
import { generateKotlin } from "./generate-kotlin.ts";
import { generateSwift } from "./generate-swift.ts";
import type { NativeManifest } from "./manifest.ts";
import { buildManifest } from "./manifest.ts";
import { packageRoot } from "./template.ts";

const GENERATED = "generated";

export function nativeDir(root: string, platform: string): string {
  return path.join(root, platform);
}

export function appleTargetName(appName: string): string {
  return `${appName[0]?.toUpperCase() ?? ""}${appName.slice(1)}Native`;
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writeOnce(file: string, contents: string): void {
  if (fs.existsSync(file)) return;
  write(file, contents);
}

function resetGenerated(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function applePackage(root: string, target: string): string {
  const flypath = posix(path.relative(nativeDir(root, "apple"), packageRoot));

  return `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: ${JSON.stringify(target)},
  platforms: [.iOS(.v15)],
  products: [
    .library(name: ${JSON.stringify(target)}, targets: [${JSON.stringify(target)}]),
  ],
  dependencies: [
    .package(name: "Flypath", path: ${JSON.stringify(flypath)}),
  ],
  targets: [
    .target(
      name: ${JSON.stringify(target)},
      dependencies: [.product(name: "Flypath", package: "Flypath")],
      path: "Sources"
    ),
  ]
)
`;
}

export type ScaffoldOptions = {
  root: string;
  appName: string;
};

export function scaffoldNative(options: ScaffoldOptions): NativeManifest {
  const manifest = buildManifest(options.root);
  if (manifest.modules.length === 0) return manifest;

  const cxx = manifest.modules.filter((module) => module.cpp !== undefined);
  const platform = manifest.modules.filter(
    (module) => module.cpp === undefined,
  );

  if (cxx.length > 0) {
    const generated = path.join(nativeDir(options.root, "cpp"), GENERATED);
    resetGenerated(generated);
    for (const module of cxx) {
      write(
        path.join(generated, `${module.base}.flypath.h`),
        generateCxxHeader(module),
      );
    }
    write(
      path.join(nativeDir(options.root, "cpp"), ".clangd"),
      clangdConfig([
        generated,
        path.join(packageRoot, "cpp", "include"),
        path.join(packageRoot, "cpp", "abi", "include"),
      ]),
    );
  }

  if (platform.length === 0) return manifest;

  const target = appleTargetName(options.appName);
  const apple = nativeDir(options.root, "apple");
  const sources = path.join(apple, "Sources");

  writeOnce(
    path.join(apple, "Package.swift"),
    applePackage(options.root, target),
  );
  resetGenerated(path.join(sources, GENERATED));
  for (const module of platform) {
    write(
      path.join(sources, GENERATED, `${module.slug}.swift`),
      generateSwift(module),
    );
  }

  const kotlin = path.join(
    nativeDir(options.root, "android"),
    "src",
    "main",
    "kotlin",
  );

  fs.mkdirSync(kotlin, { recursive: true });
  resetGenerated(path.join(kotlin, GENERATED));
  write(
    path.join(kotlin, GENERATED, "FlypathGenerated.kt"),
    generateKotlin(manifest),
  );

  return manifest;
}

export async function writeSourcekitConfig(root: string): Promise<void> {
  let sdk: string;
  try {
    sdk = (
      await run("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
        capture: true,
      })
    ).trim();
  } catch {
    return;
  }
  if (sdk === "") return;

  const arch = process.arch === "x64" ? "x86_64" : "arm64";
  const dir = path.join(nativeDir(root, "apple"), ".sourcekit-lsp");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    `${JSON.stringify(
      {
        swiftPM: {
          triple: `${arch}-apple-ios15.0-simulator`,
          swiftCompilerFlags: ["-sdk", sdk],
          cCompilerFlags: ["-isysroot", sdk],
          cxxCompilerFlags: ["-isysroot", sdk],
        },
      },
      null,
      2,
    )}\n`,
  );
}

export function cxxSources(root: string): string[] {
  const generated = path.join(nativeDir(root, "cpp"), GENERATED);
  const dir = nativeDir(root, "cpp");
  const files: string[] = [];
  for (const [base, extensions] of [
    [dir, [".cpp", ".h", ".hpp"]],
    [generated, [".h"]],
  ] as Array<[string, string[]]>) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!extensions.some((value) => entry.name.endsWith(value))) continue;
      files.push(path.join(base, entry.name));
    }
  }
  return files.sort();
}

export function kotlinSourceDirs(root: string): string[] {
  const kotlin = path.join(nativeDir(root, "android"), "src", "main", "kotlin");
  return fs.existsSync(kotlin) ? [kotlin] : [];
}
