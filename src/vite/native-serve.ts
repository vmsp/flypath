import path from "node:path";

import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { DevEnvironment, ViteDevServer } from "vite";

import type { NativeBundle, NativeModule } from "./bundler.ts";
import { NativeBundler, wrapModule } from "./bundler.ts";
import type { NativePlatform } from "./native-env.ts";
import { nativeEnvironmentName } from "./native-env.ts";

const POLYFILLS = [
  "@react-native/js-polyfills/console.js",
  "@react-native/js-polyfills/error-guard.js",
  "react-native/Libraries/Core/InitializeCore.js",
];

export type StackFrame = {
  file?: string;
  methodName?: string;
  lineNumber?: number;
  column?: number;
  [key: string]: unknown;
};

export type HotModuleUpdate = {
  moduleId: number;
  code: string;
  sourceURL: string;
};

export class NativeServer {
  #server: ViteDevServer;
  #distDir: string;
  #bundlers = new Map<NativePlatform, NativeBundler>();
  #bundles = new Map<NativePlatform, NativeBundle>();
  #traces = new Map<NativePlatform, TraceMap>();
  #dirty = new Set<NativePlatform>();

  constructor(server: ViteDevServer, distDir: string) {
    this.#server = server;
    this.#distDir = distDir;
  }

  environment(platform: NativePlatform): DevEnvironment {
    const name = nativeEnvironmentName(platform);
    const environment = this.#server.environments[name];
    if (!environment) {
      throw new Error(`flypath: missing "${name}" environment`);
    }
    return environment as DevEnvironment;
  }

  bundler(platform: NativePlatform): NativeBundler {
    let bundler = this.#bundlers.get(platform);
    if (!bundler) {
      bundler = new NativeBundler(
        this.environment(platform),
        this.#server.config.root,
      );
      this.#bundlers.set(platform, bundler);
    }
    return bundler;
  }

  entries(): string[] {
    return [
      ...POLYFILLS,
      path.join(this.#distDir, "runtime", "native-entry.js"),
    ];
  }

  serverUrl(): string {
    const { port, host } = this.#server.config.server;
    const hostname = typeof host === "string" ? host : "localhost";
    return `http://${hostname}:${port ?? 8081}`;
  }

  markDirty(platform: NativePlatform): void {
    this.#dirty.add(platform);
  }

  async bundle(platform: NativePlatform, dev: boolean): Promise<NativeBundle> {
    const cached = this.#bundles.get(platform);
    if (cached && !this.#dirty.has(platform)) return cached;

    const bundle = await this.bundler(platform).build({
      entries: this.entries(),
      platform,
      dev,
      serverUrl: this.serverUrl(),
    });

    this.#bundles.set(platform, bundle);
    this.#traces.delete(platform);
    this.#dirty.delete(platform);
    return bundle;
  }

  platforms(): NativePlatform[] {
    return [...this.#bundles.keys()];
  }

  async hotUpdate(
    file: string,
  ): Promise<Array<{ platform: NativePlatform; update: HotModuleUpdate }>> {
    const updates: Array<{
      platform: NativePlatform;
      update: HotModuleUpdate;
    }> = [];

    for (const [platform, bundler] of this.#bundlers) {
      if (!bundler.modules.has(file)) continue;
      bundler.invalidate([file]);
      const mod: NativeModule = await bundler.transformOne(file);
      const inverse = bundler.inverseDependencies(mod.moduleId);
      updates.push({
        platform,
        update: {
          moduleId: mod.moduleId,
          code: wrapModule(mod, true, inverse),
          sourceURL: `${this.serverUrl()}${mod.url}`,
        },
      });
      this.markDirty(platform);
    }

    return updates;
  }

  #trace(platform: NativePlatform): TraceMap | undefined {
    const cached = this.#traces.get(platform);
    if (cached) return cached;
    const bundle = this.#bundles.get(platform);
    if (!bundle) return undefined;
    const trace = new TraceMap(bundle.map as never);
    this.#traces.set(platform, trace);
    return trace;
  }

  async symbolicate(stack: StackFrame[]): Promise<StackFrame[]> {
    const platform = this.#bundles.keys().next().value as
      | NativePlatform
      | undefined;
    if (!platform) return stack;
    await this.bundle(platform, true);
    const trace = this.#trace(platform);
    if (!trace) return stack;

    return stack.map((frame) => {
      if (
        typeof frame.lineNumber !== "number" ||
        typeof frame.column !== "number"
      ) {
        return frame;
      }
      const original = originalPositionFor(trace, {
        line: frame.lineNumber,
        column: frame.column,
      });
      if (original.source === null) return frame;
      return {
        ...frame,
        file: original.source,
        lineNumber: original.line ?? frame.lineNumber,
        column: original.column ?? frame.column,
        methodName: original.name ?? frame.methodName,
      };
    });
  }
}
