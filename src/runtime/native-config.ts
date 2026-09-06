export type NativeConfig = {
  platform: string;
  serverUrl: string;
  dev: boolean;
  manifestHash: string;
};

export function nativeConfig(): NativeConfig {
  const config = globalThis.__FLYPATH__;
  if (!config) {
    throw new Error(
      "flypath: the native prelude did not run, so there is no server to " +
        'talk to — run "pnpm ios" or "pnpm android"',
    );
  }
  return config;
}

export function findSourceMapURL(
  filename: string,
  environmentName: string,
): string {
  const { serverUrl } = nativeConfig();
  const query =
    `filename=${encodeURIComponent(filename)}` +
    `&environmentName=${encodeURIComponent(environmentName)}`;
  return `${serverUrl}/__vite_rsc_findSourceMapURL?${query}`;
}
