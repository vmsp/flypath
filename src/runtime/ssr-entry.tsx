import {
  createFromReadableStream,
  getClientEntryUrl,
} from "@vitejs/plugin-rsc/ssr";
import type { ReactNode } from "react";
import { use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { prerender } from "react-dom/static.edge";
import { injectRSCPayload } from "rsc-html-stream/server";

import type { RscPayload } from "./payload.ts";

export type SsrOptions = {
  formState?: unknown;
  signal?: AbortSignal;
};

export async function handleSsr(
  rscStream: ReadableStream<Uint8Array>,
  options: SsrOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const [forHtml, forInline] = rscStream.tee();

  let payload: Promise<RscPayload> | undefined;
  function SsrRoot(): ReactNode {
    payload ??= createFromReadableStream<RscPayload>(forHtml);
    return use(payload).root;
  }

  const html = await renderToReadableStream(<SsrRoot />, {
    bootstrapModules: [getClientEntryUrl()],
    formState: options.formState,
    signal: options.signal,
  } as never);

  return html.pipeThrough(injectRSCPayload(forInline));
}

export async function renderEmailHtml(
  rscStream: ReadableStream<Uint8Array>,
): Promise<string> {
  let payload: Promise<RscPayload> | undefined;
  function EmailRoot(): ReactNode {
    payload ??= createFromReadableStream<RscPayload>(rscStream);
    return use(payload).root;
  }

  let failure: unknown;
  const { prelude } = await prerender(<EmailRoot />, {
    onError: (error: unknown) => {
      failure ??= error;
    },
  } as never);
  if (failure !== undefined) throw failure;

  return new Response(prelude as ReadableStream<Uint8Array>).text();
}
