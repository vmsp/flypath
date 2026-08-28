export type NativeConfig = {
  platform: string;
  serverUrl: string;
  dev: boolean;
};

export function nativeConfig(): NativeConfig {
  return (globalThis as unknown as { __FLYPATH__: NativeConfig }).__FLYPATH__;
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
