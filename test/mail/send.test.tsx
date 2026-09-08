/** @jsxImportSource ./jsx */
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { Preview, Subject } from "../../src/mail/document.tsx";
import { htmlToText } from "../../src/mail/text.ts";
import { checkAttachments, smtpTransport } from "../../src/mail/transport.ts";
import type { MailMessage } from "../../src/mail/transport.ts";
import type { Mailpit } from "./harness.ts";
import { hasMailpit, mailpit } from "./harness.ts";
import { render } from "./render.ts";

const DARK = "@media (prefers-color-scheme: dark)";

const LOGO = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const UNSUPPORTED_BUDGET = 12;

const KNOWN: ReadonlySet<string> = new Set([
  "css-at-media",
  "css-display-none",
  "css-max-height",
  "css-max-width",
  "css-opacity",
  "css-outline",
  "css-overflow-wrap",
  "css-text-decoration",
  "html-body",
  "html-style",
]);

let server: Mailpit;

beforeAll(async () => {
  const started = await mailpit();
  if (!started) throw new Error("mailpit failed to start");
  server = started;
}, 30_000);

afterAll(async () => {
  await server.stop();
});

function matches(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

async function deliver(message: MailMessage): Promise<void> {
  await server.clear();

  const rendered = await render(() => message.content as never, {
    baseUrl: "https://example.com",
  });
  checkAttachments(rendered.context.cids, message.attachments);

  await smtpTransport(server.smtpUrl).send(message, {
    html: rendered.html,
    text: htmlToText(rendered.html),
    subject: rendered.context.subject as string,
    from: message.from ?? "Flypath <hello@example.com>",
  });
}

function Welcome({ name }: { name: string }): ReactNode {
  return (
    <div style={{ padding: 24 }}>
      <Subject>Olá, {name}! ☕</Subject>
      <Preview>Your account is ready.</Preview>
      <meta content="Flypath" name="author" />
      <img alt="Flypath" src="cid:logo" style={{ width: 96 }} />
      <h1 style={{ color: { default: "#111", [DARK]: "#eee" } }}>
        Welcome, {name}!
      </h1>
      <p>Glad you are here.</p>
      <a href="/settings">Finish your profile</a>
    </div>
  );
}

describe.runIf(hasMailpit())("delivery", () => {
  test("round-trips a message through smtp", async () => {
    await deliver({
      to: [{ email: "someone@example.com", name: "Someone" }],
      cc: "watcher@example.com",
      bcc: "blind@example.com",
      content: <Welcome name="Someone" />,
      attachments: [
        { cid: "logo", content: LOGO, filename: "logo.png" },
        { content: "hello", filename: "notes.txt" },
      ],
    });

    const message = await server.latest();
    expect(message.Subject).toBe("Olá, Someone! ☕");
    expect(message.To.map((entry) => entry.Address)).toEqual([
      "someone@example.com",
    ]);
    expect(message.Cc.map((entry) => entry.Address)).toEqual([
      "watcher@example.com",
    ]);

    expect(message.Inline.map((part) => part.ContentID)).toEqual(["logo"]);
    expect(message.Inline.map((part) => part.ContentType)).toEqual([
      "image/png",
    ]);
    expect(message.Attachments.map((part) => part.FileName)).toEqual([
      "notes.txt",
    ]);

    expect(message.HTML).toContain("Welcome, Someone!");
    expect(message.Text).toContain("Glad you are here.");
    expect(message.Text).toContain(
      "Finish your profile (https://example.com/settings)",
    );
    expect(message.Text).not.toContain("Your account is ready.");
  });

  test("never puts Bcc on the wire but still delivers to it", async () => {
    const raw = await server.raw();
    const sent = raw.slice(raw.indexOf("From:"));
    expect(sent).not.toMatch(/^Bcc:/im);
    expect(sent).toMatch(/^Cc:/im);

    const message = await server.latest();
    expect(message.Bcc.map((entry) => entry.Address)).toEqual([
      "blind@example.com",
    ]);
  });

  test("carries one <style> holding only the conditional rules", async () => {
    const message = await server.latest();
    expect(matches(message.HTML, /<style[^>]*>/g).length).toBeLessThanOrEqual(
      2,
    );
    expect(message.HTML).toContain("color: #eee !important");
    expect(message.HTML).not.toContain("var(--");
    expect(message.HTML).toMatch(/<h1[^>]*style="[^"]*color:#111/);
  });

  test("passes mailpit's caniemail check within budget", async () => {
    const check = await server.htmlCheck();
    expect(check.Total.Unsupported).toBeLessThanOrEqual(UNSUPPORTED_BUDGET);

    const flagged = check.Warnings.filter(
      (warning) => warning.Score.Unsupported > 0,
    ).map((warning) => warning.Slug);
    expect(flagged.filter((slug) => !KNOWN.has(slug))).toEqual([]);
  });
});
