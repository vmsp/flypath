import {
  appUrl,
  mailFrom as mailFromEnv,
  smtpUrl as smtpUrlEnv,
} from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
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
    url: declared.url ?? smtpUrlEnv(),
    from: declared.from ?? mailFromEnv(),
    baseUrl: declared.baseUrl ?? appUrl(),
  };
}

export function smtpUrl(): string {
  const { url } = mailConfig();
  if (url) return url;
  throw new FlypathError("No mail transport is configured", {
    hint: "Set SMTP_URL in .env",
  });
}

export function mailFrom(): string {
  const { from } = mailConfig();
  if (from) return from;
  throw new FlypathError("This message has no sender", {
    hint:
      "Pass from to sendMail(), declare mail.from in vite.config.ts, or " +
      "set MAIL_FROM in .env",
  });
}
