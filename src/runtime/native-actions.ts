import {
  createFromFetch,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";

import { nativeRouter } from "../components/native/router-store.ts";
import { getRouter } from "../router/dispatch.ts";
import { ROOT_CONTAINER } from "../router/manifest.ts";
import { NAVIGATE_HEADER, parseCommand } from "../router/navigation.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import type { RscPayload } from "./payload.ts";

export function installServerCallback(): void {
  setServerCallback(async (id: string, args: unknown[]) => {
    const { serverUrl, platform } = nativeConfig();
    const router = nativeRouter();
    const temporaryReferences = createTemporaryReferenceSet();
    const body = await encodeReply(args, { temporaryReferences });

    const response = await fetch(`${serverUrl}${router?.currentUrl() ?? "/"}`, {
      method: "POST",
      body: body as never,
      headers: {
        "x-rsc-action": id,
        "x-flypath-platform": platform,
        "x-flypath-screen": router?.currentContainer() ?? ROOT_CONTAINER,
      },
    });

    const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
    if (command) {
      const api = getRouter();
      if (command.kind === "back") api?.back();
      else api?.go(command.to, command.mode);
      return undefined;
    }

    const payload = await createFromFetch<RscPayload>(
      Promise.resolve(response),
      { temporaryReferences, findSourceMapURL } as Parameters<
        typeof createFromFetch
      >[1],
    );

    router?.applyPayload(Promise.resolve(payload));
    return payload.returnValue;
  });
}
