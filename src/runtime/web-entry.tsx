import "./web-references.ts";
import {
  createFromFetch,
  createFromReadableStream,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/react/browser";
import type { ReactNode } from "react";
import { startTransition, useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { rscStream } from "rsc-html-stream/client";

import type { RscPayload } from "./payload.ts";

let update: ((payload: RscPayload) => void) | null = null;

function swap(payload: RscPayload): void {
  startTransition(() => update?.(payload));
}

function fetchFlight(): Promise<Response> {
  const url = new URL(window.location.href);
  url.searchParams.set("__flight", "1");
  return fetch(url);
}

async function callServer(id: string, args: unknown[]): Promise<unknown> {
  const temporaryReferences = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences });
  const payload = await createFromFetch<RscPayload>(
    fetch(window.location.href, {
      method: "POST",
      body,
      headers: { "x-rsc-action": id },
    }),
    { temporaryReferences },
  );
  swap(payload);
  return payload.returnValue;
}

async function main(): Promise<void> {
  const initial = await createFromReadableStream<RscPayload>(rscStream);

  function Root(): ReactNode {
    const [payload, setPayload] = useState(initial);
    useEffect(() => {
      update = setPayload;
      return () => {
        update = null;
      };
    }, []);
    return payload.root;
  }

  setServerCallback(callServer);
  hydrateRoot(document, <Root />, { formState: initial.formState } as never);

  if (import.meta.hot) {
    import.meta.hot.on("rsc:update", () => {
      void createFromFetch<RscPayload>(fetchFlight()).then(swap);
    });
  }
}

void main();
