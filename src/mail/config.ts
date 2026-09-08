import { globals } from "../shared/globals.ts";

export type MailOptions = {
  url?: string | undefined;
  from?: string | undefined;
  baseUrl?: string | undefined;
};

export function configureMail(options: MailOptions): void {
  const state = globals();
  state.mailConfig = { ...state.mailConfig, ...options };
}

export function mailConfig(): MailOptions {
  const declared = globals().mailConfig ?? {};
  return {
    url: declared.url ?? process.env["SMTP_URL"],
    from: declared.from ?? process.env["MAIL_FROM"],
    baseUrl: declared.baseUrl ?? process.env["APP_URL"],
  };
}

export function smtpUrl(): string {
  const { url } = mailConfig();
  if (url) return url;
  throw new Error(
    "flypath: no mail transport is configured; set SMTP_URL in .env",
  );
}

export function mailFrom(): string {
  const { from } = mailConfig();
  if (from) return from;
  throw new Error(
    "flypath: this message has no sender; pass from to sendMail(), declare " +
      "mail.from in vite.config.ts, or set MAIL_FROM in .env",
  );
}
