import { describe, expect, test } from "vitest";

import { htmlToText } from "../../src/mail/text.ts";

describe("htmlToText", () => {
  test("breaks on block tags and on <br>", () => {
    expect(htmlToText("<p>one</p><p>two<br/>three</p>")).toBe(
      "one\n\ntwo\nthree\n",
    );
  });

  test("collapses a run of breaks to one blank line", () => {
    expect(
      htmlToText("<div><div><div>deep</div></div></div><p>after</p>"),
    ).toBe("deep\n\nafter\n");
  });

  test("collapses whitespace inside text", () => {
    expect(htmlToText("<p>one   two\n\tthree</p>")).toBe("one two three\n");
  });

  test("renders a link as text and url", () => {
    expect(htmlToText('<a href="https://example.com/x">Open</a>')).toBe(
      "Open (https://example.com/x)\n",
    );
  });

  test("does not repeat a link whose text is the url", () => {
    expect(
      htmlToText('<a href="https://example.com">https://example.com</a>'),
    ).toBe("https://example.com\n");
  });

  test("renders image alt text in brackets", () => {
    expect(htmlToText('<p><img alt="Logo" src="cid:logo"/>after</p>')).toBe(
      "[Logo]after\n",
    );
    expect(htmlToText('<p><img alt="" src="cid:logo"/>after</p>')).toBe(
      "after\n",
    );
  });

  test("decodes named, decimal and hex entities", () => {
    expect(
      htmlToText("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>"),
    ).toBe(`a & b <c> "d" 'e'\n`);
    expect(htmlToText("<p>&#8364; &#x20AC;</p>")).toBe("€ €\n");
  });

  test("skips the preheader, the head and any <style>", () => {
    const html =
      "<html><head><title>T</title></head><body>" +
      '<div style="display:none;max-height:0">hidden preheader</div>' +
      "<style>.fp-a { color: red; }</style>" +
      "<p>visible</p></body></html>";
    expect(htmlToText(html)).toBe("visible\n");
  });

  test("skips a script and ignores comments", () => {
    expect(
      htmlToText("<p>a</p><script>var x = 1;</script><!-- note --><p>b</p>"),
    ).toBe("a\n\nb\n");
  });

  test("ends with exactly one newline", () => {
    expect(htmlToText("<p>only</p>\n\n\n")).toBe("only\n");
  });

  test("survives a nested hidden element", () => {
    const html =
      '<div style="display: none"><div>inner</div>tail</div><p>after</p>';
    expect(htmlToText(html)).toBe("after\n");
  });
});
