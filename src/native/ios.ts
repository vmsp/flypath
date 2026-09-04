import fs from "node:fs";
import path from "node:path";

import { generateCorePackage } from "./apple.ts";
import { loadOptions } from "./config.ts";
import { run } from "./exec.ts";
import {
  generateAppleComponents,
  generateAppleRegistry,
} from "./generate-cpp.ts";
import { generateCxxAdapters } from "./generate-cxx.ts";
import { formatPlist, mergePlist, parsePlist } from "./plist.ts";
import {
  appleTargetName,
  cxxSources,
  nativeDir,
  scaffoldApple,
  scaffoldNative,
  writeSourcekitConfig,
} from "./scaffold.ts";
import type { ProjectContext } from "./template.ts";
import {
  iosOrientations,
  materialize,
  outputDir,
  packageRoot,
  projectContext,
} from "./template.ts";

export type IosOptions = {
  device?: string;
  port?: number;
  root?: string;
};

type Simulator = {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
};

async function pickSimulator(name?: string): Promise<Simulator> {
  const raw = await run("xcrun", ["simctl", "list", "devices", "-j"], {
    capture: true,
  });
  const parsed = JSON.parse(raw) as {
    devices: Record<string, Simulator[]>;
  };

  const runtimes = Object.keys(parsed.devices)
    .filter((key) => key.includes("iOS"))
    .sort();

  const all = runtimes
    .flatMap((key) => parsed.devices[key] ?? [])
    .filter((device) => device.isAvailable);

  const match = name
    ? all.find((device) => device.name === name)
    : (all.find((device) => device.state === "Booted") ??
      all.findLast((device) => device.name.startsWith("iPhone")));

  if (!match) {
    throw new Error(
      name
        ? `flypath: no available simulator named "${name}"`
        : "flypath: no available iOS simulator found",
    );
  }
  return match;
}

function applyOverlay(context: ProjectContext, target: string): void {
  const apple = nativeDir(context.root, "apple");
  const app = path.join(target, "App");

  fs.rmSync(path.join(app, "Resources"), { recursive: true, force: true });
  fs.symlinkSync(path.join(apple, "Resources"), path.join(app, "Resources"));

  const plist = path.join(app, "Info.plist");
  fs.writeFileSync(
    plist,
    formatPlist(
      mergePlist(
        parsePlist(fs.readFileSync(plist, "utf8")),
        parsePlist(fs.readFileSync(path.join(apple, "Info.plist"), "utf8")),
      ),
    ),
  );

  fs.copyFileSync(
    path.join(apple, "App.entitlements"),
    path.join(app, "App.entitlements"),
  );
}

export async function runIos(options: IosOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const port = options.port ?? configured.port;
  const context = projectContext(root, port, configured);
  const target = outputDir(root, "ios");

  scaffoldApple(context);
  const manifest = scaffoldNative(context);
  const cxx = manifest.modules.filter((module) => module.cpp !== undefined);
  const platform = manifest.modules.filter(
    (module) => module.cpp === undefined,
  );

  fs.rmSync(target, { recursive: true, force: true });
  materialize("ios", target, context, [
    [
      "__FLYPATH_ORIENTATIONS__",
      iosOrientations(context)
        .map((entry) => `\t\t<string>${entry}</string>`)
        .join("\n"),
    ],
  ]);
  applyOverlay(context, target);

  generateCorePackage({
    target,
    consumer:
      platform.length === 0
        ? undefined
        : {
            name: appleTargetName(context.projectName),
            dir: nativeDir(root, "apple"),
          },
    extra: cxx.length === 0 ? [] : cxxSources(root),
    generated: {
      "FlypathGenerated.cpp": generateAppleRegistry(manifest),
      "FlypathGeneratedComponents.mm": generateAppleComponents(manifest),
      ...(cxx.length === 0
        ? {}
        : { "FlypathCxxAdapters.cpp": generateCxxAdapters(cxx) }),
    },
  });

  if (platform.length > 0) await writeSourcekitConfig(root);

  const spmScript = path.join(
    root,
    "node_modules",
    "react-native",
    "scripts",
    "setup-apple-spm.js",
  );
  if (!fs.existsSync(spmScript)) {
    throw new Error(
      "flypath: react-native 0.87 is required for the SPM-only iOS setup",
    );
  }

  const configCommand = JSON.stringify([
    process.execPath,
    path.join(packageRoot, "dist", "native", "spm-config.js"),
    target,
    target,
    path.join(root, "node_modules", "react-native"),
  ]);

  await run(
    "node",
    [
      spmScript,
      "add",
      "--yes",
      "--xcodeproj",
      path.join(target, "App.xcodeproj"),
      "--product-name",
      "App",
      "--config-command",
      configCommand,
    ],
    { cwd: target },
  );

  const simulator = await pickSimulator(options.device);
  const derived = path.join(target, "derived");
  const xcconfig = path.join(nativeDir(root, "apple"), "App.xcconfig");

  await run(
    "xcodebuild",
    [
      "-project",
      path.join(target, "App.xcodeproj"),
      "-scheme",
      "App",
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      `id=${simulator.udid}`,
      "-derivedDataPath",
      derived,
      ...(fs.existsSync(xcconfig) ? ["-xcconfig", xcconfig] : []),
      "build",
    ],
    { cwd: target },
  );

  const app = path.join(
    derived,
    "Build",
    "Products",
    "Debug-iphonesimulator",
    "App.app",
  );

  if (simulator.state !== "Booted") {
    await run("xcrun", ["simctl", "boot", simulator.udid]);
  }
  await run("open", ["-a", "Simulator"]);
  await run("xcrun", ["simctl", "install", simulator.udid, app]);
  await run("xcrun", [
    "simctl",
    "launch",
    "--console-pty",
    simulator.udid,
    context.bundleId,
  ]);
}
