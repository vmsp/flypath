declare module "virtual:flypath/routes" {
  export const tree: import("../router/types.ts").RouteTree;
}

declare module "virtual:flypath/route-manifest" {
  export const manifest: import("../router/manifest.ts").RouteManifest;
}

declare module "virtual:flypath/client-references" {
  export const registry: Record<string, unknown>;
}

declare module "virtual:flypath/native-references" {
  export const nativeReferences: Record<string, unknown>;
}

declare module "react-native-fetch-api" {
  export const fetch: unknown;
  export const Headers: unknown;
  export const Request: unknown;
  export const Response: unknown;
}

declare module "text-encoding" {
  export const TextEncoder: unknown;
  export const TextDecoder: unknown;
}

declare module "virtual:flypath/styles.css" {}

declare module "virtual:flypath/database" {}

declare module "virtual:vite-rsc/client-references" {
  const references: Record<string, () => Promise<unknown>>;
  export default references;
}

declare const __vite_rsc_raw_import__: (id: string) => Promise<unknown>;

declare module "react-native/Libraries/NativeComponent/NativeComponentRegistry" {
  import type { HostComponent } from "react-native";

  export function get<Props>(
    name: string,
    viewConfigProvider: () => {
      uiViewClassName: string;
      validAttributes: Record<string, boolean>;
      bubblingEventTypes?: Record<string, unknown>;
      directEventTypes?: Record<string, unknown>;
    },
  ): HostComponent<Props>;
}
