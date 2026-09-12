import fs from "node:fs";
import path from "node:path";

import { FlypathError } from "../shared/errors.ts";
import type { NativePlatform } from "../vite/native-env.ts";

export function enabledNativePlatforms(root: string): NativePlatform[] {
  return (["ios", "android"] as const).filter((platform) =>
    fs
      .statSync(path.join(root, platform === "ios" ? "apple" : "android"), {
        throwIfNoEntry: false,
      })
      ?.isDirectory(),
  );
}

export function buildPlatforms(root: string, value?: string): NativePlatform[] {
  const enabled = enabledNativePlatforms(root);
  if (value === undefined) return enabled;
  const selected = new Set<NativePlatform>();
  for (const entry of value
    .split(",")
    .map((part) => part.trim().toLowerCase())) {
    if (entry === "web") continue;
    if (entry === "all" || entry === "native") {
      for (const platform of enabled) selected.add(platform);
    } else if (entry === "ios" || entry === "android") {
      if (!enabled.includes(entry)) {
        throw new FlypathError(`Platform "${entry}" is not enabled`, {
          hint: `Run flypath ${entry} to create the native project`,
        });
      }
      selected.add(entry);
    } else {
      throw new FlypathError(`Unknown platform "${entry}"`, {
        hint: "Use web, ios, android, or all",
      });
    }
  }
  return [...selected];
}
