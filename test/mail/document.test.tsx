/** @jsxImportSource ./jsx */
import { describe, expect, test, vi } from "vitest";

import { Preview, Subject } from "../../src/mail/document.tsx";
import { jsx } from "./jsx/jsx-runtime.ts";
import { render } from "./render.ts";

const DARK = "@media (prefers-color-scheme: dark)";

function matches(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

const silently = async <T,>(run: () => Promise<T>): Promise<T> => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return await run();
  } finally {
    warn.mockRestore();
  }
};

describe("<Subject>", () => {
  test("records the text and renders a <title>", async () => {
    const { html, context } = await render(() => (
      <div>
        <Subject>Welcome, {"Someone"}!</Subject>
      </div>
    ));
    expect(context.subject).toBe("Welcome, Someone!");
    expect(html).toContain("<title>Welcome, Someone!</title>");
  });

  test("lets the last one win", async () => {
    const { context } = await render(() => (
      <div>
        <Subject>first</Subject>
        <Subject>second</Subject>
      </div>
    ));
    expect(context.subject).toBe("second");
  });

  test("throws outside an email", () => {
    expect(() => Subject({ children: "nope" })).toThrow(/only renders inside/);
  });
});

describe("<Preview>", () => {
  test("renders a hidden div padded with zero-width space", async () => {
    const { html } = await render(() => (
      <Preview>Your account is ready.</Preview>
    ));
    expect(html).toContain("Your account is ready.");
    expect(html).toMatch(/display:none/);
    expect(html).toContain("​ ​ ");
  });

  test("throws outside an email", () => {
    expect(() => Preview({ children: "nope" })).toThrow(/only renders inside/);
  });
});

describe("the document", () => {
  test("hoists a <meta> written in the body into the head", async () => {
    const { html } = await render(() => (
      <div>
        <meta content="Flypath" name="author" />
      </div>
    ));
    const head = html.slice(0, html.indexOf("<body"));
    expect(head).toContain('<meta content="Flypath" name="author"/>');
  });

  test("takes lang and dir from sendMail", async () => {
    const { html } = await render(() => <div>hi</div>, {
      dir: "rtl",
      lang: "pt",
    });
    expect(html).toContain('<html dir="rtl" lang="pt">');
  });

  test("throws on <html>, <head> and <body>", async () => {
    for (const tag of ["html", "head", "body"] as const) {
      await expect(
        render(() => {
          const Tag = tag as unknown as "div";
          return <Tag>nope</Tag>;
        }),
      ).rejects.toThrow(/sendMail\(\{ html \}\)/);
    }
  });

  test('throws on a "use client" component', async () => {
    const ClientThing = Object.assign(
      function ClientThing(): null {
        return null;
      },
      { $$typeof: Symbol.for("react.client.reference") },
    );

    await expect(
      render(() => {
        const Component = ClientThing as unknown as () => null;
        return <Component />;
      }),
    ).rejects.toThrow(/use client/);
  });
});

describe("styles", () => {
  test("collect into one <style> in the head, reset first, deduped", async () => {
    const conditional = { color: { default: "#111", [DARK]: "#eee" } } as const;
    const rendered = await render(() => (
      <div>
        <p style={conditional}>one</p>
        <p style={conditional}>two</p>
        <p style={{ backgroundColor: { default: "#fff", [DARK]: "#000" } }}>
          three
        </p>
      </div>
    ));

    const { html, raw } = rendered;
    expect(matches(raw, /<style[^>]*>/g)).toHaveLength(1);
    expect(html.indexOf("<style>* { box-sizing")).toBeLessThan(
      html.indexOf("<body"),
    );

    const start = html.indexOf("<style>* { box-sizing");
    const sheet = html.slice(start, html.indexOf("</style>", start));
    expect(sheet.indexOf("box-sizing")).toBeLessThan(sheet.indexOf("color:"));
    expect(matches(sheet, /color: #eee !important/g)).toHaveLength(1);
    expect(sheet).toContain("background-color: #000 !important");
  });

  test("inline the unconditional half on the element", async () => {
    const { html } = await render(() => (
      <p style={{ color: { default: "#111", [DARK]: "#eee" }, padding: 8 }}>
        hi
      </p>
    ));
    expect(html).toMatch(/<p [^>]*style="[^"]*color:#111/);
    expect(html).toMatch(/padding-top:8px/);
  });
});

describe("<img>", () => {
  test("gains border and a width attribute from a numeric style", async () => {
    const { html } = await render(
      () => <img alt="Logo" src="cid:logo" style={{ width: 96 }} />,
      { baseUrl: "https://example.com" },
    );
    expect(html).toContain('border="0"');
    expect(html).toContain('width="96"');
  });

  test("collects cid: references and leaves the src alone", async () => {
    const { html, context } = await render(
      () => <img alt="Logo" src="cid:logo" />,
      { baseUrl: "https://example.com" },
    );
    expect([...context.cids]).toEqual(["logo"]);
    expect(html).toContain('src="cid:logo"');
  });

  test("absolutises a relative src and href against baseUrl", async () => {
    const { html } = await render(
      () => (
        <div>
          <img alt="Logo" src="/logo.png" />
          <a href="/settings">Finish your profile</a>
        </div>
      ),
      { baseUrl: "https://example.com" },
    );
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('href="https://example.com/settings"');
  });

  test("leaves an absolute url alone", async () => {
    const { html } = await render(() => (
      <img alt="Logo" src="https://cdn.example.com/logo.png" />
    ));
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  test("throws on a relative url with no baseUrl", async () => {
    await expect(
      render(() => <img alt="Logo" src="/logo.png" />),
    ).rejects.toThrow(/baseUrl/);
  });

  test("warns when alt is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(() => jsx("img", { src: "https://example.com/logo.png" }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("alt text"));
    warn.mockRestore();
  });
});

describe("finishEmail", () => {
  test("tidies react's output and adds the mso block once", async () => {
    const { html, raw } = await silently(async () =>
      render(() => (
        <div>
          <img alt="Logo" src="https://example.com/logo.png" />
          <p style={{ color: { default: "#111", [DARK]: "#eee" } }}>hi</p>
        </div>
      )),
    );

    expect(raw).toContain('rel="preload"');
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain("data-precedence");
    expect(html).not.toContain("data-href");
    expect(html).not.toContain("<!--$-->");
    expect(matches(html, /\[if mso\]/g)).toHaveLength(1);
    expect(html).toContain("<head><!--[if mso]>");
  });
});
