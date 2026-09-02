import "./web-references.ts";
import {
  createFromFetch,
  createFromReadableStream,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";
import { hydrateRoot } from "react-dom/client";
import { rscStream } from "rsc-html-stream/client";

import {
  ACTION_HEADER,
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  REVALIDATE_HEADER,
} from "../protocol/headers.ts";
import { parseCommand, parseLocation } from "../router/navigation.ts";
import { parseRevalidate } from "../router/revalidate.ts";
import type { RscPayload } from "./payload.ts";
import {
  applyCommand,
  bump,
  refreshPayload,
  swapPayload,
  WebRouter,
} from "./router-web.tsx";

async function callServer(id: string, args: unknown[]): Promise<unknown> {
  const temporaryReferences = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences });
  const response = await fetch(window.location.href, {
    method: "POST",
    body,
    headers: { [ACTION_HEADER]: id },
  });

  const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
  const location = parseLocation(response.headers.get(LOCATION_HEADER));
  const mode =
    parseRevalidate(response.headers.get(REVALIDATE_HEADER)) ?? "stale";

  if (command && (response.status === 204 || !response.body)) {
    void response.body?.cancel();
    bump(mode);
    applyCommand(command);
    return undefined;
  }

  const payload = await createFromFetch<RscPayload>(Promise.resolve(response), {
    temporaryReferences,
  });

  bump(mode);

  if (command) {
    applyCommand(command, { command, location, payload });
    return payload.returnValue;
  }

  if (mode !== "none") swapPayload(payload);
  return payload.returnValue;
}

async function main(): Promise<void> {
  const initial = await createFromReadableStream<RscPayload>(rscStream);

  setServerCallback(callServer);
  hydrateRoot(document, <WebRouter initial={initial} />, {
    formState: initial.formState,
  } as never);

  if (import.meta.hot) {
    import.meta.hot.on("rsc:update", () => {
      bump("reset");
      refreshPayload();
    });
  }
}

void main();
