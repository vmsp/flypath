import type { ReactNode } from "react";

import { EMAIL_RESET } from "../styles/email.ts";
import { requireMail } from "./context.ts";

export type Text = string | number | readonly (string | number)[];

function joinText(children: Text): string {
  return Array.isArray(children)
    ? (children as readonly (string | number)[]).join("")
    : String(children);
}

export function Subject({ children }: { children: Text }): ReactNode {
  const context = requireMail("<Subject>");
  const text = joinText(children);
  context.subject = text;
  return <title>{text}</title>;
}

const PREHEADER = {
  color: "transparent",
  display: "none",
  fontSize: 1,
  lineHeight: 1,
  maxHeight: 0,
  maxWidth: 0,
  opacity: 0,
} as const;

const PADDING = "\u200B\u00A0".repeat(120);

export function Preview({ children }: { children: Text }): ReactNode {
  requireMail("<Preview>");
  return (
    <div style={PREHEADER}>
      {joinText(children)}
      {PADDING}
    </div>
  );
}

export type ShellProps = {
  children: ReactNode;
  dir?: "ltr" | "rtl" | undefined;
  lang?: string | undefined;
};

export function EmailDocument({ children, dir, lang }: ShellProps): ReactNode {
  return (
    <html dir={dir} lang={lang ?? "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />
        <style href="fp-email-reset" precedence="flypath">
          {EMAIL_RESET}
        </style>
      </head>
      <body>{children}</body>
    </html>
  );
}
