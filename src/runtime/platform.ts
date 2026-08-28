export type Platform = "web" | "ios" | "android";

const KEY = "__flypathRequest";

export type RequestInfo = {
  platform: Platform;
  pathname: string;
};

export type RequestStore = { get: () => RequestInfo | undefined };

type Holder = {
  [KEY]?: RequestStore;
  __FLYPATH__?: { platform?: string };
};

const holder = globalThis as unknown as Holder;

export function setRequestStore(store: RequestStore): void {
  holder[KEY] = store;
}

export function parsePlatform(
  value: string | null | undefined,
): Platform | undefined {
  return value === "web" || value === "ios" || value === "android"
    ? value
    : undefined;
}

export function getPlatform(): Platform {
  return (
    holder[KEY]?.get()?.platform ??
    parsePlatform(holder.__FLYPATH__?.platform) ??
    "web"
  );
}

export function getPathname(): string {
  return holder[KEY]?.get()?.pathname ?? "/";
}

export function isNative(): boolean {
  return getPlatform() !== "web";
}

export function isIos(): boolean {
  return getPlatform() === "ios";
}

export function isAndroid(): boolean {
  return getPlatform() === "android";
}
