import type { Location, NavigationCommand } from "../../router/navigation.ts";
import type { RevalidateMode } from "../../router/revalidate.ts";
import type { RscPayload } from "../../runtime/payload.ts";

export type Commit = {
  key: string | undefined;
  mode: RevalidateMode;
  payload: RscPayload | undefined;
  command: NavigationCommand | undefined;
  location: Location | undefined;
};

export type NativeRouterApi = {
  currentUrl: () => string;
  currentContainer: () => string;
  currentKey: () => string | undefined;
  chromeIds: () => readonly string[];
  commit: (commit: Commit) => void;
};

let current: NativeRouterApi | undefined;

export function setNativeRouter(api: NativeRouterApi): () => void {
  current = api;
  return () => {
    if (current === api) current = undefined;
  };
}

export function nativeRouter(): NativeRouterApi | undefined {
  return current;
}
