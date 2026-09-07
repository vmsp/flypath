import { AsyncLocalStorage } from "node:async_hooks";

import { singleton } from "../shared/globals.ts";
import type { RequestInfo } from "./platform.ts";

const storage: AsyncLocalStorage<RequestInfo> = singleton(
  "requestStorage",
  () => new AsyncLocalStorage<RequestInfo>(),
);

export function runWithRequest<T>(info: RequestInfo, fn: () => T): T {
  return storage.run(info, fn);
}
