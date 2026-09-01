import type { RscPayload } from "../../runtime/payload.ts";

export type NativeRouterApi = {
  currentUrl: () => string;
  currentContainer: () => string;
  applyPayload: (payload: Promise<RscPayload>) => void;
};

let current: NativeRouterApi | undefined;

export function setNativeRouter(api: NativeRouterApi | undefined): void {
  current = api;
}

export function nativeRouter(): NativeRouterApi | undefined {
  return current;
}
