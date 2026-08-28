import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestInfo } from "./platform.ts";
import { setRequestStore } from "./platform.ts";

const KEY = "__flypathRequestStorage";

type Holder = { [KEY]?: AsyncLocalStorage<RequestInfo> };

const holder = globalThis as unknown as Holder;
const storage: AsyncLocalStorage<RequestInfo> = (holder[KEY] ??=
  new AsyncLocalStorage<RequestInfo>());

setRequestStore({ get: () => storage.getStore() });

export function runWithRequest<T>(info: RequestInfo, fn: () => T): T {
  return storage.run(info, fn);
}
