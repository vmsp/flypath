import {
  createFromReadableStream,
  getClientEntryUrl,
} from "@vitejs/plugin-rsc/ssr";
import type { ReactNode } from "react";
import { use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { injectRSCPayload } from "rsc-html-stream/server";

import type { RscPayload } from "./payload.ts";

export type SsrOptions = { formState?: unknown };

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
  } as never);

  return html.pipeThrough(injectRSCPayload(forInline));
}
