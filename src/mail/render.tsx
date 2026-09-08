import { renderToReadableStream } from "@vitejs/plugin-rsc/rsc";
import type { ReactNode } from "react";

import type { RscPayload } from "../runtime/payload.ts";
import { collect, replay } from "../runtime/stream.ts";
import type { MailContext } from "./context.ts";
import { runInMail } from "./context.ts";
import { EmailDocument } from "./document.tsx";
import { finishEmail } from "./finish.ts";

export type RenderOptions = {
  baseUrl?: string | undefined;
  dir?: "ltr" | "rtl" | undefined;
  lang?: string | undefined;
};

export type RenderedEmail = {
  html: string;
  subject: string | undefined;
  cids: ReadonlySet<string>;
};

export async function renderEmail(
  content: ReactNode,
  options: RenderOptions = {},
): Promise<RenderedEmail> {
  const context: MailContext = {
    subject: undefined,
    baseUrl: options.baseUrl,
    cids: new Set(),
  };

  let failure: unknown;
  const bytes = await runInMail(context, async () => {
    const stream = renderToReadableStream<RscPayload>(
      {
        root: (
          <EmailDocument dir={options.dir} lang={options.lang}>
            {content}
          </EmailDocument>
        ),
      },
      {
        onError: (error: unknown) => {
          failure ??= error;
        },
      } as never,
    );
    return collect(stream);
  });
  if (failure !== undefined) throw failure;

  const ssr = await import.meta.viteRsc.loadModule<
    typeof import("../runtime/ssr-entry.tsx")
  >("ssr", "index");

  return {
    html: finishEmail(await ssr.renderEmailHtml(replay(bytes))),
    subject: context.subject,
    cids: context.cids,
  };
}
