import fs from "node:fs";
import path from "node:path";

import { run } from "./exec.ts";
import {
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

export async function runIos(options: IosOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const port = options.port ?? 8081;
  const context = projectContext(root, port);
  const target = outputDir(root, "ios");

  fs.rmSync(target, { recursive: true, force: true });
  materialize("ios", target, context);

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
