import {
  createFromReadableStream,
  getClientEntryUrl,
} from "@vitejs/plugin-rsc/ssr";
import type { ReactNode } from "react";
import { use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { injectRSCPayload } from "rsc-html-stream/server";

import { NavigationContext } from "../router/client.ts";
import type { Navigation, Params, SearchParams } from "../router/types.ts";
import type { RscPayload } from "./payload.ts";

export type SsrOptions = {
  formState?: unknown;
  pathname?: string;
  params?: Params;
  searchParams?: SearchParams;
};

export async function handleSsr(
  rscStream: ReadableStream<Uint8Array>,
  options: SsrOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const [forHtml, forInline] = rscStream.tee();

  const navigation: Navigation = {
    pathname: options.pathname ?? "/",
    params: options.params ?? {},
    searchParams: options.searchParams ?? {},
  };

  let payload: Promise<RscPayload> | undefined;
  function SsrRoot(): ReactNode {
    payload ??= createFromReadableStream<RscPayload>(forHtml);
    return (
      <NavigationContext.Provider value={navigation}>
        {use(payload).root}
      </NavigationContext.Provider>
    );
  }

  const html = await renderToReadableStream(<SsrRoot />, {
    bootstrapModules: [getClientEntryUrl()],
    formState: options.formState,
  } as never);

  return html.pipeThrough(injectRSCPayload(forInline));
}
