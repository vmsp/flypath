import { createTransport } from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type { ReactNode } from "react";

export type Address = string | { name?: string; email: string };

export type Attachment = {
  filename: string;
  content: Uint8Array | ArrayBuffer | string;
  contentType?: string;
  cid?: string;
  inline?: boolean;
};

export type MailMessage = {
  to: Address | readonly Address[];
  from?: Address;
  cc?: Address | readonly Address[];
  bcc?: Address | readonly Address[];
  replyTo?: Address | readonly Address[];
  returnPath?: string;
  subject?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
  content?: ReactNode;
  html?: string;
  text?: string | false;
  attachments?: readonly Attachment[];
  headers?: Readonly<Record<string, string>>;
  baseUrl?: string;
};

export type MailResult = {
  messageId: string;
  accepted: readonly string[];
  rejected: readonly string[];
  response: string;
};

export type Rendered = {
  html: string;
  text: string | undefined;
  subject: string;
  from: Address;
};

export type Transport = {
  send: (message: MailMessage, rendered: Rendered) => Promise<MailResult>;
};

export class MailError extends Error {
  readonly code: string | undefined;
  readonly responseCode: number | undefined;
  readonly retryable: boolean;

  constructor(cause: unknown) {
    const detail = cause as {
      message?: unknown;
      code?: unknown;
      responseCode?: unknown;
    };
    super(
      typeof detail.message === "string"
        ? `flypath: the mail transport rejected the message: ${detail.message}`
        : "flypath: the mail transport rejected the message",
      { cause },
    );
    this.name = "MailError";
    this.code = typeof detail.code === "string" ? detail.code : undefined;
    this.responseCode =
      typeof detail.responseCode === "number" ? detail.responseCode : undefined;
    this.retryable =
      this.responseCode === undefined
        ? true
        : this.responseCode >= 400 && this.responseCode < 500;
  }
}

export type SmtpOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  tls?: { rejectUnauthorized: boolean };
};

export function parseSmtpUrl(raw: string): SmtpOptions {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `flypath: SMTP_URL is not a url: ${raw}. It looks like ` +
        "smtp://user:password@host:587 or smtps://user:password@host:465",
    );
  }

  const secure = url.protocol === "smtps:";
  if (!secure && url.protocol !== "smtp:") {
    throw new Error(
      `flypath: SMTP_URL speaks "${url.protocol.replace(":", "")}", and the ` +
        'mail transport speaks "smtp" (upgraded with STARTTLS) or "smtps" ' +
        "(TLS from the first byte)",
    );
  }
  if (url.hostname === "") {
    throw new Error(`flypath: SMTP_URL has no host: ${raw}`);
  }

  const options: SmtpOptions = {
    host: decodeURIComponent(url.hostname),
    port: url.port === "" ? (secure ? 465 : 587) : Number(url.port),
    secure,
  };

  if (url.username !== "") {
    options.auth = {
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password),
    };
  }

  const tls = url.searchParams.get("tls");
  if (tls === "required") options.requireTLS = true;
  if (tls === "off") options.ignoreTLS = true;
  if (url.searchParams.get("rejectUnauthorized") === "false") {
    options.tls = { rejectUnauthorized: false };
  }

  return options;
}

function one(value: Address): string | { name: string; address: string } {
  if (typeof value === "string") return value;
  return value.name === undefined
    ? value.email
    : { name: value.name, address: value.email };
}

function many(
  value: Address | readonly Address[] | undefined,
): (string | { name: string; address: string })[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value)
    ? (value as readonly Address[])
    : [value as Address];
  return list.map(one);
}

function body(content: Attachment["content"]): Buffer | string {
  if (typeof content === "string") return content;
  return Buffer.from(
    content instanceof ArrayBuffer ? new Uint8Array(content) : content,
  );
}

export function composeMessage(
  message: MailMessage,
  rendered: Rendered,
): SendMailOptions {
  const options: SendMailOptions = {
    from: one(rendered.from),
    to: many(message.to),
    subject: rendered.subject,
    html: rendered.html,
  };

  if (rendered.text !== undefined) options.text = rendered.text;
  if (message.cc !== undefined) options.cc = many(message.cc);
  if (message.bcc !== undefined) options.bcc = many(message.bcc);
  if (message.replyTo !== undefined) options.replyTo = many(message.replyTo);
  if (message.returnPath !== undefined) options.sender = message.returnPath;
  if (message.headers !== undefined) options.headers = { ...message.headers };

  if (message.attachments !== undefined && message.attachments.length > 0) {
    options.attachments = message.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: body(attachment.content),
      ...(attachment.contentType === undefined
        ? {}
        : { contentType: attachment.contentType }),
      ...(attachment.cid === undefined ? {} : { cid: attachment.cid }),
      ...(attachment.inline === undefined
        ? {}
        : { contentDisposition: attachment.inline ? "inline" : "attachment" }),
    }));
  }

  return options;
}

type Info = {
  messageId?: unknown;
  accepted?: unknown;
  rejected?: unknown;
  response?: unknown;
};

function toResult(info: Info): MailResult {
  const list = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.map(String) : [];
  return {
    messageId: String(info.messageId ?? ""),
    accepted: list(info.accepted),
    rejected: list(info.rejected),
    response: typeof info.response === "string" ? info.response : "",
  };
}

const DEV = process.env.NODE_ENV !== "production";

export function checkAttachments(
  cids: ReadonlySet<string>,
  attachments: readonly Attachment[] | undefined,
): void {
  const declared = new Set<string>();
  for (const attachment of attachments ?? []) {
    if (attachment.cid !== undefined) declared.add(attachment.cid);
  }
  for (const cid of cids) {
    if (declared.has(cid)) continue;
    throw new Error(
      `flypath: <img src="cid:${cid}"> has no attachment to point at; pass ` +
        `sendMail({ attachments: [{ cid: "${cid}", filename: …, content: … }] })`,
    );
  }
  if (!DEV) return;
  for (const cid of declared) {
    if (cids.has(cid)) continue;
    console.warn(
      `flypath: the attachment with cid "${cid}" is inlined into the message ` +
        `but nothing references it; write <img src="cid:${cid}"> or drop the cid`,
    );
  }
}

export function smtpTransport(url: string): Transport {
  const transporter = createTransport(parseSmtpUrl(url));
  return {
    send: async (message, rendered) => {
      try {
        return toResult(
          (await transporter.sendMail(
            composeMessage(message, rendered),
          )) as Info,
        );
      } catch (error) {
        throw new MailError(error);
      }
    },
  };
}

type SentMessage = {
  envelope: { from: string; to: readonly string[] };
  messageId: string;
  raw: string;
};

export type MemoryTransport = Transport & {
  readonly sent: readonly SentMessage[];
  clear: () => void;
};

export function memoryTransport(): MemoryTransport {
  const transporter = createTransport({ streamTransport: true, buffer: true });
  const sent: SentMessage[] = [];

  return {
    sent,
    clear: () => {
      sent.length = 0;
    },
    send: async (message, rendered) => {
      let info;
      try {
        info = await transporter.sendMail(composeMessage(message, rendered));
      } catch (error) {
        throw new MailError(error);
      }
      const envelope = info.envelope as { from?: unknown; to?: unknown };
      sent.push({
        envelope: {
          from: String(envelope.from ?? ""),
          to: Array.isArray(envelope.to) ? envelope.to.map(String) : [],
        },
        messageId: String(info.messageId),
        raw: Buffer.from(info.message as Buffer).toString("utf8"),
      });
      return {
        messageId: String(info.messageId),
        accepted: Array.isArray(envelope.to) ? envelope.to.map(String) : [],
        rejected: [],
        response: "memory",
      };
    },
  };
}
