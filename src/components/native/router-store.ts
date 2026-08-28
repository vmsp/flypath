import type { RscPayload } from "../../runtime/payload.ts";

export type NativeRouterApi = {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  refresh: () => void;
  switchTab: (key: string) => void;
  currentUrl: () => string;
  applyPayload: (payload: Promise<RscPayload>) => void;
};

let current: NativeRouterApi | undefined;

export function setNativeRouter(api: NativeRouterApi | undefined): void {
  current = api;
}

export function nativeRouter(): NativeRouterApi | undefined {
  return current;
}
