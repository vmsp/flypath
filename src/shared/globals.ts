/**
 * @fileoverview Global state, available through `globalThis`.
 */

import type { AsyncLocalStorage } from "node:async_hooks";

import type { Connection, TransactionConnection } from "../db/client.ts";
import type { Databases } from "../db/config.ts";
import type { JobsOptions } from "../jobs/config.ts";
import type { Registry } from "../jobs/registry.ts";
import type { JobContext } from "../jobs/run.ts";
import type { MailOptions } from "../mail/config.ts";
import type { MailContext } from "../mail/context.ts";
import type { NativeRegistry } from "../runtime/native-bindings.ts";
import type { NativeConfig } from "../runtime/native-config.ts";
import type { RequestInfo } from "../runtime/platform.ts";

/** Global server-side framework state. Available when executing in Node. */
type FlypathState = {
  databases: Databases;
  jobsConfig: JobsOptions;
  jobRegistry: Registry;
  jobStorage: AsyncLocalStorage<JobContext>;
  mailConfig: MailOptions;
  mailStorage: AsyncLocalStorage<MailContext>;
  pools: Map<string, Connection>;
  requestStorage: AsyncLocalStorage<RequestInfo>;
  tableColumns: Map<string, readonly string[]>;
  transactions: AsyncLocalStorage<Map<string, TransactionConnection>>;
};

declare global {
  /** State injected from outside JS into the runtime. */
  var __FLYPATH__:
    | (NativeConfig & {
        native?: NativeRegistry;
        chunks?: Record<string, number>;
      })
    | undefined;

  /** Node global state. */
  var __FLYPATH_STATE__: Partial<FlypathState> | undefined;

  // Metro
  var __r: (moduleId: number) => unknown;
  var __loadBundleAsync: ((path: string) => Promise<void>) | undefined;

  // `__flypathNamespace` and `__flypathLazy` are also defined. The first adapts
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
