import {
  createFromFetch,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";

import { nativeRouter } from "../components/native/router-store.ts";
import {
  ACTION_HEADER,
  CHROME_HEADER,
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  PLATFORM_HEADER,
  REVALIDATE_HEADER,
  SCREEN_HEADER,
} from "../protocol/headers.ts";
import { getRouter } from "../router/dispatch.ts";
import { ROOT_CONTAINER } from "../router/manifest.ts";
import { parseCommand, parseLocation } from "../router/navigation.ts";
import { parseRevalidate } from "../router/revalidate.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import type { RscPayload } from "./payload.ts";

export function installServerCallback(): void {
  setServerCallback(async (id: string, args: unknown[]) => {
    const { serverUrl, platform } = nativeConfig();
    const router = nativeRouter();
    const temporaryReferences = createTemporaryReferenceSet();
    const body = await encodeReply(args, { temporaryReferences });

    const key = router?.currentKey();
    const chrome = router?.chromeIds() ?? [];

    const response = await fetch(`${serverUrl}${router?.currentUrl() ?? "/"}`, {
      method: "POST",
      body: body as never,
      headers: {
        [ACTION_HEADER]: id,
        [PLATFORM_HEADER]: platform,
        [SCREEN_HEADER]: router?.currentContainer() ?? ROOT_CONTAINER,
        ...(chrome.length === 0 ? {} : { [CHROME_HEADER]: chrome.join(",") }),
      },
    });

    const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
    const location = parseLocation(response.headers.get(LOCATION_HEADER));
    const mode =
      parseRevalidate(response.headers.get(REVALIDATE_HEADER)) ?? "stale";

    const follow = (): void => {
      const api = getRouter();
      if (!command) return;
      if (command.kind === "back") api?.back();
      else api?.go(command.to, command.mode);
    };

    if (command && response.status === 204) {
      router?.commit({ key, mode, payload: undefined, command, location });
      follow();
      return undefined;
    }

    const payload = await createFromFetch<RscPayload>(
      Promise.resolve(response),
      { temporaryReferences, findSourceMapURL } as Parameters<
        typeof createFromFetch
      >[1],
    );

    router?.commit({ key, mode, payload, command, location });
    follow();
    return payload.returnValue;
  });
}
