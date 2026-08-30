import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

type NativeBinding = (...args: never[]) => unknown;

export type NativeRegistry = {
  hash: string;
  modules: Record<string, Record<string, NativeBinding>>;
  components: string[];
};

type Global = {
  __flypath?: { native?: NativeRegistry };
  __FLYPATH__?: {
    manifestHash?: string;
    serverUrl?: string;
    platform?: string;
  };
};

const scope = globalThis as unknown as Global;

const SKEW =
  'flypath: this build of the app was made from a different set of "use native" ' +
  'declarations than the running server — run "pnpm ios" or "pnpm android"';

function skewed(): boolean {
  const expected = scope.__FLYPATH__?.manifestHash;
  const actual = scope.__flypath?.native?.hash;
  if (expected === undefined || expected === "" || actual === undefined) {
    return false;
  }
  return expected !== actual;
}

export function reportNativeSkew(): void {
  if (!skewed()) return;
  console.warn(SKEW);
  const { serverUrl, platform } = scope.__FLYPATH__ ?? {};
  if (serverUrl === undefined) return;
  void fetch(`${serverUrl}/flypath-skew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform,
      binary: scope.__flypath?.native?.hash,
      server: scope.__FLYPATH__?.manifestHash,
    }),
  }).catch(() => undefined);
}

export function installNativeBindings(): void {
  if (scope.__flypath?.native) return;
  const module = TurboModuleRegistry.get<
    TurboModule & { install: () => boolean }
  >("Flypath");
  if (!module) {
    throw new Error(
      "flypath: this build of the app does not provide native bindings — " +
        'run "pnpm ios" or "pnpm android"',
    );
  }
  module.install();
}

export function nativeRegistry(): NativeRegistry {
  installNativeBindings();
  const registry = scope.__flypath?.native;
  if (!registry) {
    throw new Error("flypath: native bindings failed to install");
  }
  return registry;
}

/** @lintignore */
export function nativeModule(
  id: string,
  source: string,
): (name: string) => NativeBinding {
  const exports = nativeRegistry().modules[id];
  return (name) => {
    const binding = exports?.[name];
    if (binding) return binding;
    return () => {
      throw new Error(
        `flypath: ${name}() is not in this build of the app (${source}) — ` +
          'run "pnpm ios" or "pnpm android"',
      );
    };
  };
}
