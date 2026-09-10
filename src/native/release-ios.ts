import fs from "node:fs";
import path from "node:path";

import { BUNDLE_NAMES } from "./bundle.ts";
import { loadOptions } from "./config.ts";
import { run } from "./exec.ts";
import type { IosOptions } from "./ios.ts";
import { prepareIos } from "./ios.ts";
import { projectContext } from "./template.ts";

export type Distribution =
  | "app-store"
  | "ad-hoc"
  | "development"
  | "enterprise";

export function exportOptions(options: {
  distribution: Distribution;
  teamId: string | undefined;
  upload: boolean;
}): string {
  const entries: string[] = [
    "\t<key>method</key>",
    `\t<string>${options.distribution}</string>`,
    "\t<key>signingStyle</key>",
    "\t<string>automatic</string>",
    "\t<key>stripSwiftSymbols</key>",
    "\t<true/>",
    "\t<key>uploadSymbols</key>",
    "\t<true/>",
  ];
  if (options.teamId !== undefined) {
    entries.push("\t<key>teamID</key>", `\t<string>${options.teamId}</string>`);
  }
  if (options.upload) {
    entries.push("\t<key>destination</key>", "\t<string>upload</string>");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...entries,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function requireBundle(root: string): string {
  const bundle = path.join(root, "dist", "native", "ios", BUNDLE_NAMES.ios);
  if (!fs.existsSync(bundle)) {
    throw new Error(
      `flypath: ${path.relative(root, bundle)} does not exist — run ` +
        "`flypath build --platform ios` first, so the app ships the same " +
        "JavaScript the server was built with",
    );
  }
  return bundle;
}

export async function releaseIos(options: IosOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const bundle = requireBundle(root);

  const context = projectContext(root, configured.port, configured);
  const prepared = await prepareIos(root, context);

  fs.mkdirSync(path.join(prepared.target, "App", "Bundle"), {
    recursive: true,
  });
  fs.copyFileSync(
    bundle,
    path.join(prepared.target, "App", "Bundle", BUNDLE_NAMES.ios),
  );

  const teamId = configured.ios?.teamId;
  if (teamId === undefined && prepared.xcconfig === undefined) {
    throw new Error(
      "flypath: a release build has to be signed. Set ios.teamId in " +
        "vite.config.ts, or write apple/App.xcconfig with DEVELOPMENT_TEAM, " +
        "CODE_SIGN_STYLE and PROVISIONING_PROFILE_SPECIFIER",
    );
  }

  const dist = path.join(root, "dist");
  const archive = path.join(dist, "App.xcarchive");
  fs.rmSync(archive, { recursive: true, force: true });

  await run(
    "xcodebuild",
    [
      "archive",
      "-project",
      path.join(prepared.target, "App.xcodeproj"),
      "-scheme",
      "App",
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archive,
      "-allowProvisioningUpdates",
      ...(prepared.xcconfig === undefined
        ? []
        : ["-xcconfig", prepared.xcconfig]),
      ...(teamId === undefined ? [] : [`DEVELOPMENT_TEAM=${teamId}`]),
    ],
    { cwd: prepared.target },
  );

  if (options.xcode === true) {
    await run("open", [path.join(prepared.target, "App.xcodeproj")]);
  }

  if (options.archiveOnly === true) {
    console.log(
      [
        `flypath: archived to ${path.relative(root, archive)}`,
        "  finish it by hand with:",
        `    xcodebuild -exportArchive -archivePath ${path.relative(root, archive)} \\`,
        "      -exportOptionsPlist <options>.plist -exportPath dist",
        "  or open the archive in Xcode's Organizer",
      ].join("\n"),
    );
    return;
  }

  const plist = path.join(dist, "ExportOptions.plist");
  fs.writeFileSync(
    plist,
    exportOptions({
      distribution: configured.ios?.distribution ?? "app-store",
      teamId,
      upload: options.upload === true,
    }),
  );

  await run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archive,
      "-exportOptionsPlist",
      plist,
      "-exportPath",
      dist,
      "-allowProvisioningUpdates",
    ],
    { cwd: prepared.target },
  );

  if (options.upload === true) {
    console.log("flypath: handed the build to App Store Connect");
    return;
  }

  const ipa = fs.readdirSync(dist).find((entry) => entry.endsWith(".ipa"));
  console.log(
    ipa === undefined
      ? `flypath: exported to ${path.relative(root, dist)}`
      : `flypath: wrote dist/${ipa}`,
  );
}
