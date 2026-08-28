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

import type { RscPayload } from "./payload.ts";
import { refreshPayload, swapPayload, WebRouter } from "./router-web.tsx";

async function callServer(id: string, args: unknown[]): Promise<unknown> {
  const temporaryReferences = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences });
  const response = await fetch(window.location.href, {
    method: "POST",
    body,
    headers: { "x-rsc-action": id },
  });

  const redirect = response.headers.get("x-flypath-redirect");
  if (redirect !== null) {
    void response.body?.cancel();
    window.location.href = redirect;
    return undefined;
  }

  const payload = await createFromFetch<RscPayload>(Promise.resolve(response), {
    temporaryReferences,
  });
  swapPayload(payload);
  return payload.returnValue;
}

async function main(): Promise<void> {
  const initial = await createFromReadableStream<RscPayload>(rscStream);

  setServerCallback(callServer);
  hydrateRoot(document, <WebRouter initial={initial} />, {
    formState: initial.formState,
  } as never);

  if (import.meta.hot) {
    import.meta.hot.on("rsc:update", refreshPayload);
  }
}

void main();
