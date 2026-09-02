import {
  createFromFetch,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";

import { nativeRouter } from "../components/native/router-store.ts";
import { getRouter } from "../router/dispatch.ts";
import { ROOT_CONTAINER } from "../router/manifest.ts";
import {
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  parseCommand,
  parseLocation,
} from "../router/navigation.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import { seedPayload } from "./native-router.ts";
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
    const location = parseLocation(response.headers.get(LOCATION_HEADER));

    const follow = (): void => {
      const api = getRouter();
      if (!command) return;
      if (command.kind === "back") api?.back();
      else api?.go(command.to, command.mode);
    };

    if (command && response.status === 204) {
      follow();
      return undefined;
    }

    const payload = await createFromFetch<RscPayload>(
      Promise.resolve(response),
      { temporaryReferences, findSourceMapURL } as Parameters<
        typeof createFromFetch
      >[1],
    );

    if (command) {
      if (location) seedPayload(location, payload);
      follow();
      return payload.returnValue;
    }

    router?.applyPayload(Promise.resolve(payload));
    return payload.returnValue;
  });
}
