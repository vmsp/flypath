import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { configureMail, smtpUrl } from "../../src/mail/config.ts";
import type { MailMessage, Rendered } from "../../src/mail/transport.ts";
import {
  checkAttachments,
  composeMessage,
  MailError,
  memoryTransport,
  parseSmtpUrl,
} from "../../src/mail/transport.ts";
import { globals } from "../../src/shared/globals.ts";

const rendered = (over: Partial<Rendered> = {}): Rendered => ({
  html: "<p>hi</p>",
  text: "hi\n",
  subject: "Hello",
  from: "Flypath <hello@example.com>",
  ...over,
});

describe("SMTP_URL", () => {
  test("defaults smtp:// to port 587 and smtps:// to 465", () => {
    expect(parseSmtpUrl("smtp://mail.example.com")).toMatchObject({
      host: "mail.example.com",
      port: 587,
      secure: false,
    });
    expect(parseSmtpUrl("smtps://mail.example.com")).toMatchObject({
      port: 465,
      secure: true,
    });
  });

  test("keeps an explicit port", () => {
    expect(parseSmtpUrl("smtp://localhost:1025").port).toBe(1025);
  });

  test("percent-decodes credentials", () => {
    const options = parseSmtpUrl("smtp://a%40b.com:p%40ss%3Aword@host:587");
    expect(options.auth).toEqual({ user: "a@b.com", pass: "p@ss:word" });
  });

  test("leaves auth out when there are no credentials", () => {
    expect(parseSmtpUrl("smtp://localhost:1025").auth).toBeUndefined();
  });

  test("maps ?tls=required and ?tls=off", () => {
    expect(parseSmtpUrl("smtp://h?tls=required").requireTLS).toBe(true);
    expect(parseSmtpUrl("smtp://h?tls=off").ignoreTLS).toBe(true);
    expect(parseSmtpUrl("smtp://h").requireTLS).toBeUndefined();
  });

  test("maps ?rejectUnauthorized=false into the tls options", () => {
    expect(parseSmtpUrl("smtp://h?rejectUnauthorized=false").tls).toEqual({
      rejectUnauthorized: false,
    });
    expect(parseSmtpUrl("smtp://h").tls).toBeUndefined();
  });

  test("rejects a url that is not smtp", () => {
    expect(() => parseSmtpUrl("https://example.com")).toThrow(/SMTP_URL/);
    expect(() => parseSmtpUrl("not a url")).toThrow(/^SMTP_URL/);
  });
});

describe("configuration", () => {
  beforeEach(() => {
    delete globals().mailConfig;
    delete process.env["SMTP_URL"];
  });

  afterEach(() => {
    delete globals().mailConfig;
    delete process.env["SMTP_URL"];
  });

  test("throws its own message when nothing is configured", () => {
    expect(() => smtpUrl()).toThrow("No mail transport is configured");
  });

  test("reads .env when nothing is declared", () => {
    process.env["SMTP_URL"] = "smtp://localhost:1025";
    expect(smtpUrl()).toBe("smtp://localhost:1025");
  });

  test("lets a declared option win over .env", () => {
    process.env["SMTP_URL"] = "smtp://localhost:1025";
    configureMail({ url: "smtp://declared:2525" });
    expect(smtpUrl()).toBe("smtp://declared:2525");
  });
});

describe("the message mapping", () => {
  const message: MailMessage = { to: "someone@example.com", html: "<p>hi</p>" };

  test("normalises the address union", () => {
    const composed = composeMessage(
      {
        ...message,
        to: [{ email: "a@example.com", name: "A" }, "b@example.com"],
        cc: { email: "c@example.com" },
      },
      rendered(),
    );
    expect(composed.to).toEqual([
      { name: "A", address: "a@example.com" },
      "b@example.com",
    ]);
    expect(composed.cc).toEqual(["c@example.com"]);
  });

  test("carries subject, html, text and headers through", () => {
    const composed = composeMessage(
      { ...message, headers: { "X-Thing": "1" } },
      rendered(),
    );
    expect(composed).toMatchObject({
      subject: "Hello",
      html: "<p>hi</p>",
      text: "hi\n",
      headers: { "X-Thing": "1" },
      from: "Flypath <hello@example.com>",
    });
  });

  test("leaves text out when the alternative is disabled", () => {
    const composed = composeMessage(message, rendered({ text: undefined }));
    expect(composed.text).toBeUndefined();
  });
});

describe("memoryTransport", () => {
  test("composes a message with a cid part inside multipart/related", async () => {
    const transport = memoryTransport();
    await transport.send(
      {
        to: "someone@example.com",
        content: undefined,
        html: "<p>hi</p>",
        attachments: [
          {
            cid: "logo",
            content: new Uint8Array([1, 2, 3]),
            filename: "logo.png",
          },
        ],
      },
      rendered(),
    );

    const [sent] = transport.sent;
    expect(sent?.envelope.to).toEqual(["someone@example.com"]);
    expect(sent?.raw).toContain("multipart/alternative");
    expect(sent?.raw).toContain("multipart/related");
    expect(sent?.raw).toContain("Content-ID: <logo>");
    expect(sent?.raw).toContain("Content-Disposition: inline");
    expect(sent?.raw).toContain("Content-Type: image/png");
  });

  test("encodes a non-ascii subject and keeps every recipient in the envelope", async () => {
    const transport = memoryTransport();
    const result = await transport.send(
      {
        to: "a@example.com",
        cc: "b@example.com",
        bcc: "c@example.com",
        html: "<p>hi</p>",
      },
      rendered({ subject: "Olá, açúcar" }),
    );

    const [sent] = transport.sent;
    expect(sent?.envelope.to).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(sent?.raw).toMatch(/Subject: =\?UTF-8\?/);
    expect(result.accepted).toContain("c@example.com");
  });
});

describe("MailError", () => {
  test("treats a 4xx reply as retryable and a 5xx as final", () => {
    expect(
      new MailError({ responseCode: 421, code: "EENVELOPE" }),
    ).toMatchObject({ retryable: true, responseCode: 421, code: "EENVELOPE" });
    expect(new MailError({ responseCode: 550 }).retryable).toBe(false);
  });

  test("keeps the underlying error as its cause", () => {
    const cause = new Error("connection refused");
    const error = new MailError(cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("connection refused");
    expect(error).toBeInstanceOf(MailError);
  });
});

describe("cid references", () => {
  test("throw when nothing matches, naming the id", () => {
    expect(() => checkAttachments(new Set(["logo"]), [])).toThrow(/cid:logo/);
    expect(() => checkAttachments(new Set(["logo"]), undefined)).toThrow(
      /attachments/,
    );
  });

  test("pass when the attachment is there", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkAttachments(new Set(["logo"]), [
      { cid: "logo", content: "x", filename: "logo.png" },
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("warn about an attachment nothing references", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkAttachments(new Set(), [
      { cid: "orphan", content: "x", filename: "orphan.png" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("orphan"));
    warn.mockRestore();
  });
});
