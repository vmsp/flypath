import fs from "node:fs";
import path from "node:path";

import { FlypathError } from "../shared/errors.ts";
import { packageRoot } from "../shared/paths.ts";
import type { Progress } from "../terminal/output.ts";
import { note, print, step, warn } from "../terminal/output.ts";
import { generateCorePackage } from "./apple.ts";
import { loadOptions } from "./config.ts";
import { devServerRunning, firstLaunch } from "./dev-server.ts";
import type { Collector } from "./diagnostics.ts";
import { collector, showWarnings } from "./diagnostics.ts";
import { run, startLog } from "./exec.ts";
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
  projectContext,
} from "./template.ts";

export type IosOptions = {
  device?: string;
  port?: number;
  root?: string;
  host?: string;
  release?: boolean;
  archiveOnly?: boolean;
  upload?: boolean;
  xcode?: boolean;
  console?: boolean;
};

function applyOverlay(context: ProjectContext, target: string): void {
  const apple = nativeDir(context.root, "apple");
  const app = path.join(target, "App");

  fs.rmSync(path.join(app, "Resources"), { recursive: true, force: true });
  fs.symlinkSync(path.join(apple, "Resources"), path.join(app, "Resources"));

  const overlay = parsePlist(
    fs.readFileSync(path.join(apple, "Info.plist"), "utf8"),
  );
  for (const name of ["Info.plist", "Info.debug.plist"]) {
    const plist = path.join(app, name);
    if (!fs.existsSync(plist)) continue;
    fs.writeFileSync(
      plist,
      formatPlist(
        mergePlist(parsePlist(fs.readFileSync(plist, "utf8")), overlay),
      ),
    );
  }

  fs.mkdirSync(path.join(app, "Bundle"), { recursive: true });

  fs.copyFileSync(
    path.join(apple, "App.entitlements"),
    path.join(app, "App.entitlements"),
  );
}

/**
 * Handle `/bin/sh` not being `/bin/bash` on macOS like
 * `generate-spm-xcodeproj.js` expects.
 *
 * https://github.com/react/react-native/issues/58359
 */
function forceBashScripts(target: string): void {
  const project = path.join(target, "App.xcodeproj", "project.pbxproj");
  fs.writeFileSync(
    project,
    fs
      .readFileSync(project, "utf8")
      .replaceAll("shellPath = /bin/sh;", "shellPath = /bin/bash;"),
  );

  const schemes = path.join(
    target,
    "App.xcodeproj",
    "xcshareddata",
    "xcschemes",
  );
  if (!fs.existsSync(schemes)) return;

  const guard =
    "[ -n &quot;${BASH_VERSION-}&quot; ] || [ ! -x /bin/bash ] ||" +
    " exec /bin/bash &quot;$0&quot; &quot;$@&quot;\n";

  for (const entry of fs.readdirSync(schemes)) {
    if (!entry.endsWith(".xcscheme")) continue;
    const scheme = path.join(schemes, entry);
    fs.writeFileSync(
      scheme,
      fs
        .readFileSync(scheme, "utf8")
        .replaceAll('scriptText = "', `scriptText = "${guard}`),
    );
  }
}

export type PreparedIos = {
  target: string;
  context: ProjectContext;
  xcconfig: string | undefined;
  derived: string;
};

export async function prepareIos(
  root: string,
  context: ProjectContext,
): Promise<PreparedIos> {
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
    throw new FlypathError("The iOS project needs react-native 0.87", {
      hint: "Add react-native@0.87 to this project's dependencies",
    });
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

  forceBashScripts(target);

  const overlay = path.join(nativeDir(root, "apple"), "App.xcconfig");
  return {
    target,
    context,
    xcconfig: fs.existsSync(overlay) ? overlay : undefined,
    derived: path.join(target, "derived"),
  };
}

export async function xcodebuild(
  root: string,
  cwd: string,
  args: string[],
  progress: Progress,
): Promise<Collector> {
  const build = collector(root, "xcode");
  await run("xcodebuild", args, {
    cwd,
    env: { NSUnbufferedIO: "YES" },
    onLine: (line) => {
      const label = build.feed(line);
      if (label !== undefined) progress.status(label);
    },
    failure: (output) => build.failure(output),
  });
  return build;
}

export function generating(): { active: string; done: string } {
  return {
    active: "Generating the Xcode project",
    done: "Generated the Xcode project",
  };
}

async function attach(args: string[]): Promise<void> {
  print("");
  note("Attached to the app's console. Ctrl-C to stop");
  await run("xcrun", args, { attach: true });
}

export async function runIos(options: IosOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const port = options.port ?? configured.port;
  startLog(root, "ios");

  if (options.release === true) {
    const { releaseIos } = await import("./release-ios.ts");
    await releaseIos({ ...options, root });
    return;
  }

  const { iosTargets, pick, resolveHost } = await import("./device.ts");
  const chosen = pick(await iosTargets(true), options.device, undefined);
  const onDevice = chosen.kind === "device";
  const host = onDevice ? resolveHost(options.host) : "localhost";
  const context = projectContext(root, port, configured, host);

  const prepared = await step(generating(), () => prepareIos(root, context));

  const build = await step(
    {
      active: `Building for ${chosen.name}`,
      done: `Built for ${chosen.name}`,
      failed: `Build failed for ${chosen.name}`,
    },
    (progress) =>
      xcodebuild(
        root,
        prepared.target,
        [
          "-project",
          path.join(prepared.target, "App.xcodeproj"),
          "-scheme",
          "App",
          "-configuration",
          "Debug",
          "-sdk",
          onDevice ? "iphoneos" : "iphonesimulator",
          "-destination",
          `id=${chosen.id}`,
          "-derivedDataPath",
          prepared.derived,
          ...(prepared.xcconfig === undefined
            ? []
            : ["-xcconfig", prepared.xcconfig]),
          ...(onDevice
            ? [
                "-allowProvisioningUpdates",
                "FLYPATH_CODE_SIGNING_ALLOWED=YES",
                "FLYPATH_CODE_SIGNING_REQUIRED=YES",
                ...(configured.ios?.teamId === undefined
                  ? []
                  : [`DEVELOPMENT_TEAM=${configured.ios.teamId}`]),
              ]
            : []),
          "build",
        ],
        progress,
      ),
  );
  showWarnings(root, build);

  const app = path.join(
    prepared.derived,
    "Build",
    "Products",
    onDevice ? "Debug-iphoneos" : "Debug-iphonesimulator",
    "App.app",
  );

  if (!(await devServerRunning(port))) {
    warn(
      `Nothing is listening on http://localhost:${String(port)}`,
      "The app shows a red screen until flypath dev is running",
    );
  }

  const attached = options.console === true;
  const settled = attached
    ? `Installed on ${chosen.name}`
    : `Launched on ${chosen.name}`;

  if (onDevice) {
    await step(
      { active: `Installing on ${chosen.name}`, done: settled },
      async (progress) => {
        progress.summary(`reaching http://${host}:${String(port)}`);
        await run("xcrun", [
          "devicectl",
          "device",
          "install",
          "app",
          "--device",
          chosen.id,
          app,
        ]);
        if (attached) return;
        progress.status("Launching");
        await run("xcrun", [
          "devicectl",
          "device",
          "process",
          "launch",
          "--terminate-existing",
          "--device",
          chosen.id,
          context.bundleId,
        ]);
      },
      { time: false },
    );
    if (firstLaunch(root, chosen.id)) {
      note(
        "iOS asks for local-network permission the first time the app talks " +
          "to a LAN address.\nAllow it, or the bundle fetch times out",
      );
    }
    if (attached) {
      await attach([
        "devicectl",
        "device",
        "process",
        "launch",
        "--console",
        "--terminate-existing",
        "--device",
        chosen.id,
        context.bundleId,
      ]);
    }
    return;
  }

  await step(
    { active: `Launching on ${chosen.name}`, done: settled },
    async (progress) => {
      if (chosen.state !== "Booted") {
        progress.status("Booting");
        await run("xcrun", ["simctl", "boot", chosen.id]);
      }
      await run("open", ["-a", "Simulator"]);
      progress.status("Installing");
      await run("xcrun", ["simctl", "install", chosen.id, app]);
      if (attached) return;
      progress.status("Launching");
      await run("xcrun", [
        "simctl",
        "launch",
        "--terminate-running-process",
        chosen.id,
        context.bundleId,
      ]);
    },
    { time: false },
  );
  if (attached) {
    await attach([
      "simctl",
      "launch",
      "--console-pty",
      "--terminate-running-process",
      chosen.id,
      context.bundleId,
    ]);
  }
}
