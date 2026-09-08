import type { ReactNode } from "react";
import { prerender } from "react-dom/static.edge";

import type { MailContext } from "../../src/mail/context.ts";
import { runInMail } from "../../src/mail/context.ts";
import { EmailDocument } from "../../src/mail/document.tsx";
import { finishEmail } from "../../src/mail/finish.ts";

export type Rendered = {
  html: string;
  raw: string;
  context: MailContext;
};

export type Options = {
  baseUrl?: string | undefined;
  dir?: "ltr" | "rtl" | undefined;
  lang?: string | undefined;
};

export async function render(
  content: () => ReactNode,
  options: Options = {},
): Promise<Rendered> {
  const context: MailContext = {
    subject: undefined,
    baseUrl: options.baseUrl,
    cids: new Set(),
  };

  const raw = await runInMail(context, async () => {
    let failure: unknown;
    const { prelude } = await prerender(
      EmailDocument({
        children: content(),
        dir: options.dir,
        lang: options.lang,
      }),
      {
        onError: (error: unknown) => {
          failure ??= error;
        },
      } as never,
    );
    if (failure !== undefined) throw failure;
    return new Response(prelude as ReadableStream<Uint8Array>).text();
  });

  return { html: finishEmail(raw), raw, context };
}
