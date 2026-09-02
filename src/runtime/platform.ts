import type { ContextStore } from "../router/context.ts";
import type { RouteInfo } from "../router/types.ts";

export type Platform = "web" | "ios" | "android";

const KEY = "__flypathRequest";

export type RequestInfo = RouteInfo & {
  platform: Platform;
  phase: "render" | "action";
  headers: Headers;
  outgoing: Headers;
  prefetch: boolean;
  context: ContextStore;
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

export function getRequest(): RequestInfo | undefined {
  return holder[KEY]?.get();
}

export function platform(): Platform {
  return (
    getRequest()?.platform ??
    parsePlatform(holder.__FLYPATH__?.platform) ??
    "web"
  );
}

export function headers(): Headers {
  const request = getRequest();
  if (!request) {
    throw new Error(
      "flypath: headers() reads the incoming request, so it is only " +
        "available while the flypath router is handling one — in a " +
        "middleware, a server component or a server action",
    );
  }
  return new Headers(request.headers);
}

export function isPrefetch(): boolean {
  return getRequest()?.prefetch ?? false;
}

export function isNative(): boolean {
  return platform() !== "web";
}

export function isIos(): boolean {
  return platform() === "ios";
}

export function isAndroid(): boolean {
  return platform() === "android";
}
