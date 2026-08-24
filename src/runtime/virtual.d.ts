declare module "virtual:flypath/client-references" {
  export const registry: Record<string, unknown>;
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

declare module "virtual:vite-rsc/client-references" {
  const references: Record<string, () => Promise<unknown>>;
  export default references;
}

declare const __vite_rsc_raw_import__: (id: string) => Promise<unknown>;
