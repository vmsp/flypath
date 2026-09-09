import { EFFECT, forbidPrerender, getRequest } from "../runtime/platform.ts";
import { mailConfig, mailFrom, smtpUrl } from "./config.ts";
import { renderEmail } from "./render.tsx";
import { htmlToText } from "./text.ts";
import type { MailMessage, MailResult, Transport } from "./transport.ts";
import { checkAttachments, smtpTransport } from "./transport.ts";

let cached: { url: string; transport: Transport } | undefined;

function transportFor(url: string): Transport {
  if (cached?.url === url) return cached.transport;
  const transport = smtpTransport(url);
  cached = { url, transport };
  return transport;
}

function requestOrigin(): string | undefined {
  const request = getRequest();
  if (!request) return undefined;
  const host = request.headers.get("host");
  if (host === null || host === "") return undefined;
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Send an email message. */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  forbidPrerender("sendMail() was called", EFFECT);

  if ((message.content === undefined) === (message.html === undefined)) {
    throw new Error(
      "flypath: sendMail() takes either content, a react element rendered " +
        "with the components the app already has, or html, a string you " +
        "built yourself — exactly one of them",
    );
  }

  const config = mailConfig();
  let html: string;
  let subject = message.subject;
  let cids: ReadonlySet<string> = new Set();

  if (message.content === undefined) {
    html = message.html as string;
  } else {
    const rendered = await renderEmail(message.content, {
      baseUrl: message.baseUrl ?? config.baseUrl ?? requestOrigin(),
      dir: message.dir,
      lang: message.lang,
    });
    html = rendered.html;
    subject ??= rendered.subject;
    cids = rendered.cids;
  }

  if (subject === undefined) {
    throw new Error(
      "flypath: this email has no subject; render <Subject>…</Subject> " +
        "anywhere in the message, or pass subject to sendMail()",
    );
  }

  checkAttachments(cids, message.attachments);

  const text =
    message.text === false ? undefined : (message.text ?? htmlToText(html));

  return transportFor(smtpUrl()).send(message, {
    html,
    text,
    subject,
    from: message.from ?? mailFrom(),
  });
}
