export const CONFIG_PLUGIN = "flypath:config";

export type Orientation =
  | "portrait"
  | "portraitUpsideDown"
  | "landscapeLeft"
  | "landscapeRight";

export type FlypathOptions = {
  port?: number;
  appName?: string;
  bundleId?: string;
  version?: string;
  build?: number;
  ios?: {
    bundleId?: string;
    minimumVersion?: string;
    orientations?: Orientation[];
  };
  android?: {
    applicationId?: string;
    minSdk?: number;
  };
};

export async function loadOptions(root: string): Promise<FlypathOptions> {
  const { resolveConfig } = await import("vite");
  const config = await resolveConfig({ root, logLevel: "warn" }, "build");
  const plugin = config.plugins.find((entry) => entry.name === CONFIG_PLUGIN);
  return (plugin?.api as FlypathOptions | undefined) ?? {};
}
