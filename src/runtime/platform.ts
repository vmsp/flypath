import { AsyncLocalStorage } from "node:async_hooks";

export type Platform = "web" | "ios" | "android";

const storage = new AsyncLocalStorage<Platform>();

export function parsePlatform(
  value: string | null | undefined,
): Platform | undefined {
  return value === "web" || value === "ios" || value === "android"
    ? value
    : undefined;
}

export function runWithPlatform<T>(platform: Platform, fn: () => T): T {
  return storage.run(platform, fn);
}

export function getPlatform(): Platform {
  return storage.getStore() ?? "web";
}

export function isNative(): boolean {
  return getPlatform() !== "web";
}
