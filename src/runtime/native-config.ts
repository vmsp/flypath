export type NativeConfig = {
  platform: string;
  serverUrl: string;
  dev: boolean;
};

export function nativeConfig(): NativeConfig {
  return (globalThis as unknown as { __FLYPATH__: NativeConfig }).__FLYPATH__;
}
