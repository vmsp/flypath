import fs from "node:fs";
import path from "node:path";

import { link, list } from "./link.ts";
import { packageRoot } from "./template.ts";

const CORE_NAME = "FlypathCore";
const KIT_NAME = "FlypathKit";

const REACT_PRODUCTS = [
  '.product(name: "ReactHeaders", package: "ReactNative")',
  '.product(name: "ReactNativeHeaders", package: "ReactNative")',
  '.product(name: "ReactNativeDependenciesHeaders", package: "ReactNative")',
];

const CXX_DEFINES = [
  '.headerSearchPath(".")',
  '.define("DEBUG", .when(configuration: .debug))',
  '.define("NDEBUG", .when(configuration: .release))',
];

const FRAMEWORKS = [
  '.linkedFramework("UIKit")',
  '.linkedFramework("Foundation")',
  '.linkedFramework("CoreGraphics")',
];

export type AppleOptions = {
  target: string;
  consumer?: { name: string; dir: string } | undefined;
  extra?: string[];
  generated: Record<string, string>;
};

function quote(value: string): string {
  return JSON.stringify(value);
}

function corePackageManifest(options: AppleOptions): string {
  const consumer = options.consumer;

  const packages = [
    `.package(name: ${quote(KIT_NAME)}, path: ${quote(packageRoot)})`,
    ...(consumer
      ? [
          `.package(name: ${quote(consumer.name)}, path: ${quote(
            consumer.dir,
          )})`,
        ]
      : []),
    `.package(name: "ReactNative", path: ${quote(
      path.join(options.target, "build", "xcframeworks"),
    )})`,
  ];

  const dependencies = [
    `.product(name: ${quote(KIT_NAME)}, package: ${quote(KIT_NAME)})`,
    ...(consumer
      ? [
          `.product(name: ${quote(consumer.name)}, package: ${quote(
            consumer.name,
          )})`,
        ]
      : []),
    ...REACT_PRODUCTS,
  ];

  return `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: ${quote(CORE_NAME)},
  platforms: [.iOS(.v15)],
  products: [
    .library(name: ${quote(CORE_NAME)}, targets: [${quote(CORE_NAME)}]),
  ],
  dependencies: [
    ${packages.join(",\n    ")},
  ],
  targets: [
    .target(
      name: ${quote(CORE_NAME)},
      dependencies: [${dependencies.join(", ")}],
      path: "Sources",
      publicHeadersPath: "include",
      cxxSettings: [${CXX_DEFINES.join(", ")}],
      linkerSettings: [${FRAMEWORKS.join(", ")}]
    ),
  ],
  cxxLanguageStandard: .cxx20
)
`;
}

export function generateCorePackage(options: AppleOptions): void {
  const root = path.join(options.target, CORE_NAME);
  const sources = path.join(root, "Sources");

  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(sources, { recursive: true });

  for (const file of list(path.join(packageRoot, "apple", "core", "include"), [
    ".h",
  ])) {
    link(file, path.join(sources, "include", path.basename(file)));
  }
  for (const file of [
    ...list(path.join(packageRoot, "cpp"), [".h", ".cpp"]),
    ...list(path.join(packageRoot, "cpp", "include"), [".h"]),
    ...list(path.join(packageRoot, "apple", "core"), [".h", ".mm", ".cpp"]),
    ...(options.extra ?? []),
  ]) {
    link(file, path.join(sources, path.basename(file)));
  }
  for (const [name, contents] of Object.entries(options.generated)) {
    fs.writeFileSync(path.join(sources, name), contents);
  }

  fs.writeFileSync(
    path.join(root, "Package.swift"),
    corePackageManifest(options),
  );
  fs.writeFileSync(
    path.join(options.target, "react-native.config.js"),
    `module.exports = {\n  spm: {\n    modules: [{ name: ${quote(
      CORE_NAME,
    )}, path: ${quote(CORE_NAME)} }],\n  },\n};\n`,
  );
}
