import fs from "node:fs";
import path from "node:path";

import { FlypathError } from "../shared/errors.ts";
import { note, step, success } from "../terminal/output.ts";
import { size } from "../terminal/style.ts";
import { BUNDLE_NAMES } from "./bundle.ts";
import { loadOptions } from "./config.ts";
import { showWarnings } from "./diagnostics.ts";
import { run } from "./exec.ts";
import type { IosOptions } from "./ios.ts";
import { generating, prepareIos, xcodebuild } from "./ios.ts";
import { nativeDir } from "./scaffold.ts";
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
    throw new FlypathError(`${path.relative(root, bundle)} does not exist`, {
      hint:
        "Run flypath build --platform ios first, so the app ships the " +
        "JavaScript the server was built with",
    });
  }
  return bundle;
}

export async function releaseIos(options: IosOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const configured = await loadOptions(root);
  const bundle = requireBundle(root);

  const teamId = configured.ios?.teamId;
  const xcconfig = path.join(nativeDir(root, "apple"), "App.xcconfig");
  if (teamId === undefined && !fs.existsSync(xcconfig)) {
    throw new FlypathError("A release build has to be signed", {
      hint:
        "Set ios.teamId in vite.config.ts, or write apple/App.xcconfig with " +
        "DEVELOPMENT_TEAM, CODE_SIGN_STYLE and PROVISIONING_PROFILE_SPECIFIER",
    });
  }

  const context = projectContext(root, configured.port, configured);
  const prepared = await step(generating(), () => prepareIos(root, context));

  fs.mkdirSync(path.join(prepared.target, "App", "Bundle"), {
    recursive: true,
  });
  fs.copyFileSync(
    bundle,
    path.join(prepared.target, "App", "Bundle", BUNDLE_NAMES.ios),
  );

  const dist = path.join(root, "dist");
  const archive = path.join(dist, "App.xcarchive");
  const shown = path.relative(root, archive);
  fs.rmSync(archive, { recursive: true, force: true });

  const build = await step(
    {
      active: "Archiving",
      done: `Archived ${shown}`,
      failed: "Archive failed",
    },
    (progress) =>
      xcodebuild(
        root,
        prepared.target,
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
        progress,
      ),
  );
  showWarnings(root, build);

  if (options.xcode === true) {
    await run("open", [path.join(prepared.target, "App.xcodeproj")]);
  }

  if (options.archiveOnly === true) {
    note(
      `Export it with xcodebuild -exportArchive -archivePath ${shown} ` +
        "-exportOptionsPlist <options>.plist -exportPath dist, or open it in " +
        "Xcode's Organizer",
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

  const upload = options.upload === true;
  await step(
    {
      active: upload ? "Uploading to App Store Connect" : "Exporting",
      done: upload ? "Handed the build to App Store Connect" : "Exported",
      failed: upload ? "Upload failed" : "Export failed",
    },
    (progress) =>
      xcodebuild(
        root,
        prepared.target,
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
        progress,
      ),
  );
  if (upload) return;

  const ipa = fs.readdirSync(dist).find((entry) => entry.endsWith(".ipa"));
  if (ipa === undefined) {
    success(`Exported to ${path.relative(root, dist)}`);
    return;
  }
  success(`Wrote dist/${ipa}`, size(fs.statSync(path.join(dist, ipa)).size));
}
