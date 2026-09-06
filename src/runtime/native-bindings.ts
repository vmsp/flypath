import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

type NativeBinding = (...args: never[]) => unknown;

export type NativeRegistry = {
  hash: string;
  modules: Record<string, Record<string, NativeBinding>>;
  components: string[];
};

const SKEW =
  'flypath: this build of the app was made from a different set of "use native" ' +
  'declarations than the running server — run "pnpm ios" or "pnpm android"';

function skewed(): boolean {
  const expected = globalThis.__FLYPATH__?.manifestHash;
  const actual = globalThis.__FLYPATH__?.native?.hash;
  if (expected === undefined || expected === "" || actual === undefined) {
    return false;
  }
  return expected !== actual;
}

export function reportNativeSkew(): void {
  if (!skewed()) return;
  console.warn(SKEW);
  const { serverUrl, platform } = globalThis.__FLYPATH__ ?? {};
  if (serverUrl === undefined) return;
  void fetch(`${serverUrl}/flypath-skew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform,
      binary: globalThis.__FLYPATH__?.native?.hash,
      server: globalThis.__FLYPATH__?.manifestHash,
    }),
  }).catch(() => undefined);
}

export function installNativeBindings(): void {
  if (globalThis.__FLYPATH__?.native) return;
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
  const registry = globalThis.__FLYPATH__?.native;
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
