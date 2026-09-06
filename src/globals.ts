type FlypathState = {
  databases: import("./db/config.ts").Databases;
  pools: Map<string, import("./db/client.ts").Connection>;
  request: import("./runtime/platform.ts").RequestStore;
  requestStorage: import("node:async_hooks").AsyncLocalStorage<
    import("./runtime/platform.ts").RequestInfo
  >;
  tableColumns: Map<string, readonly string[]>;
  transactions: import("node:async_hooks").AsyncLocalStorage<
    Map<string, import("./db/client.ts").TransactionConnection>
  >;
};

declare global {
  /** State injected from outside JS into the runtime. */
  var __FLYPATH__:
    | (import("./runtime/native-config.ts").NativeConfig & {
        native?: import("./runtime/native-bindings.ts").NativeRegistry;
        chunks?: Record<string, number>;
      })
    | undefined;

  /** Node global state. */
  var __FLYPATH_STATE__: Partial<FlypathState> | undefined;

  // Metro
  var __r: (moduleId: number) => unknown;
  var __loadBundleAsync: ((path: string) => Promise<void>) | undefined;

  // __flypathNamespace and __flypathLazy are also defined. The first adapts
  // Metro's CJS module registry to ESM namespace semantics. The second does the
  // same but lazily. They're only referenced from generated code strings so we
  // don't include them here.

  // React Native
  var globalEvalWithSourceUrl:
    | ((code: string, url: string) => unknown)
    | undefined;
}

export function globals(): Partial<FlypathState> {
  return (globalThis.__FLYPATH_STATE__ ??= {});
}

export function singleton<K extends keyof FlypathState>(
  key: K,
  create: () => FlypathState[K],
): FlypathState[K] {
  const scope = globals();
  const existing = scope[key];
  if (existing !== undefined) return existing;
  const created = create();
  scope[key] = created;
  return created;
}
