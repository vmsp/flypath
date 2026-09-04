export const CONFIG_PLUGIN = "flypath:config";

export const DEFAULT_PORT = 8081;

export type Orientation =
  | "portrait"
  | "portraitUpsideDown"
  | "landscapeLeft"
  | "landscapeRight";

export type FlypathOptions = {
  /** Named databases and their pool options. */
  databases?: Record<
    string,
    {
      url?: string | undefined;
      max?: number;
      idleTimeout?: number;
      connectTimeout?: number;
      searchPath?: string;
      ssl?: boolean | "require" | "prefer";
    }
  >;

  /** User-facing name for the application. */
  appName?: string;

  /** User-facing version identifier. */
  version?: string;

  /**
   * Internal version number for published apps. Required by app stores to be
   * set.
   *
   * Maps to `CFBundleVersion` on iOS and `versionCode` on Android.
   */
  buildNumber?: number;

  /**
   * Unique identifier for the app. Required by app stores to be set.
   *
   * Must follow a stricter reverse-DNS format: two or more period-separated (.)
   * segments, each starting with a letter and containing only alphanumeric
   * characters (A-Z, a-z, 0-9). No segment may be a Kotlin or Java keyword.
   * E.g. `com.example.myapp`
   *
   * Maps to `CFBundleIdentifier` on iOS, and to `applicationId`, `namespace`
   * and the Kotlin package name on Android.
   */
  bundleId?: string;

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

export async function loadOptions(
  root: string,
): Promise<FlypathOptions & { port: number }> {
  const { resolveConfig } = await import("vite");
  const config = await resolveConfig({ root, logLevel: "warn" }, "build");
  const plugin = config.plugins.find((entry) => entry.name === CONFIG_PLUGIN);
  return {
    ...(plugin?.api as FlypathOptions | undefined),
    port: config.server.port ?? DEFAULT_PORT,
  };
}
