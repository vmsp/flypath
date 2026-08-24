import {
  createFromFetch,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";

import { nativeConfig } from "./native-config.ts";
import { swapPayload } from "./native-root.tsx";
import type { RscPayload } from "./payload.ts";

export function installServerCallback(): void {
  setServerCallback(async (id: string, args: unknown[]) => {
    const { serverUrl, platform } = nativeConfig();
    const temporaryReferences = createTemporaryReferenceSet();
    const body = await encodeReply(args, { temporaryReferences });

    const payload = await createFromFetch<RscPayload>(
      fetch(`${serverUrl}/?platform=${platform}`, {
        method: "POST",
        body: body as never,
        headers: { "x-rsc-action": id, "x-flypath-platform": platform },
      }),
      { temporaryReferences },
    );

    swapPayload(Promise.resolve(payload));
    return payload.returnValue;
  });
}
