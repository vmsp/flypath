import { beforeAll, describe, expect, test, vi } from "vitest";

import { EMAIL_DEFAULTS, emailStyle } from "../../src/styles/email.ts";
import { registerVars } from "../../src/styles/registry.ts";

const DARK = "@media (prefers-color-scheme: dark)";

function first<T>(list: readonly T[]): T {
  const [head] = list;
  if (head === undefined) throw new Error("expected at least one entry");
  return head;
}

beforeAll(() => {
  registerVars({
    "--brand": "#0055ff",
    "--surface": { default: "#ffffff", [DARK]: "#111318" },
    "--indirect": "var(--brand)",
  });
});

describe("plain values", () => {
  test("inline and mint no class", () => {
    const resolved = emailStyle("div", { color: "#111" });
    expect(resolved.style).toEqual({ color: "#111" });
    expect(resolved.classes).toEqual([]);
    expect(resolved.rules).toEqual([]);
  });

  test("expand shorthands into longhands", () => {
    const resolved = emailStyle("div", { padding: 8 });
    expect(resolved.style).toEqual({
      paddingBottom: 8,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 8,
    });
  });
});

describe("condition maps", () => {
  test("inline the default and emit only the branches", () => {
    const resolved = emailStyle("div", {
      color: { default: "#111", [DARK]: "#eee" },
    });
    expect(resolved.style).toEqual({ color: "#111" });
    expect(resolved.classes).toHaveLength(1);
    const rule = first(resolved.rules);
    expect(rule.css).toBe(
      `${DARK} { .${rule.className} { color: #eee !important; } }`,
    );
    expect(rule.css).not.toContain("#111");
  });

  test("keep pseudo classes", () => {
    const resolved = emailStyle("a", {
      color: { default: "#111", ":hover": "#f00" },
    });
    const rule = first(resolved.rules);
    expect(rule.css).toBe(
      `.${rule.className}:hover { color: #f00 !important; }`,
    );
  });

  test("serialize numbers with px unless the property is unitless", () => {
    const sized = emailStyle("div", {
      width: { default: 10, ":hover": 20 },
    });
    expect(first(sized.rules).css).toContain("width: 20px");

    const weighted = emailStyle("div", {
      opacity: { default: 1, ":hover": 0.5 },
    });
    expect(first(weighted.rules).css).toContain("opacity: 0.5 !important;");
  });

  test("give different rules different class names", () => {
    const one = emailStyle("div", {
      color: { default: "#111", [DARK]: "#eee" },
    });
    const two = emailStyle("div", {
      color: { default: "#111", [DARK]: "#ddd" },
    });
    expect(first(one.rules).className).not.toBe(first(two.rules).className);
  });

  test("resolve a build-time $c/$v marker through $v", () => {
    const marker = {
      color: {
        $c: { color: "fp-web" },
        $v: { default: "#111", [DARK]: "#eee" },
      },
    };
    const resolved = emailStyle("div", marker);
    expect(resolved.style).toEqual({ color: "#111" });
    expect(resolved.classes).not.toContain("fp-web");
    expect(first(resolved.rules).css).toContain("#eee");
  });
});

describe("css variables", () => {
  test("resolve a registered scalar to its literal", () => {
    const resolved = emailStyle("div", { color: "var(--brand, #0055ff)" });
    expect(resolved.style).toEqual({ color: "#0055ff" });
    expect(resolved.rules).toEqual([]);
  });

  test("resolve a registered condition map into inline plus a media rule", () => {
    const resolved = emailStyle("div", {
      backgroundColor: "var(--surface, #ffffff)",
    });
    expect(resolved.style).toEqual({ backgroundColor: "#ffffff" });
    const rule = first(resolved.rules);
    expect(rule.css).toBe(
      `${DARK} { .${rule.className} { background-color: #111318 !important; } }`,
    );
  });

  test("follow a token that points at another token", () => {
    const resolved = emailStyle("div", { color: "var(--indirect)" });
    expect(resolved.style).toEqual({ color: "#0055ff" });
  });

  test("fall back to the literal in the var() when nothing is registered", () => {
    const resolved = emailStyle("div", { color: "var(--missing, #abc)" });
    expect(resolved.style).toEqual({ color: "#abc" });
  });

  test("throw when nothing is registered and there is no fallback", () => {
    expect(() => emailStyle("div", { color: "var(--missing)" })).toThrow(
      /--missing/,
    );
  });
});

describe("what an email cannot carry", () => {
  test("throws on a css.override theme", () => {
    expect(() => emailStyle("div", { "--brand": "hotpink" })).toThrow(
      /css\.override/,
    );
  });

  test("throws on an animation", () => {
    expect(() => emailStyle("div", { animationName: "kf-spin" })).toThrow(
      /keyframes/,
    );
  });

  test("warns about a property no inbox honours but still emits it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = emailStyle("div", { position: "absolute" });
    expect(resolved.style).toEqual({ position: "absolute" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("position"));
    warn.mockRestore();
  });
});

describe("tag defaults", () => {
  test("inline what a browser would apply to an untouched tag", () => {
    const resolved = emailStyle("h1", {});
    expect(resolved.style).toMatchObject({
      fontSize: 32,
      fontWeight: "700",
      lineHeight: 1.5,
      marginBottom: 0,
      marginTop: 0,
    });
  });

  test("let the author's style win", () => {
    const resolved = emailStyle("a", { color: "#f0f" });
    expect(resolved.style).toMatchObject({
      color: "#f0f",
      textDecorationLine: "underline",
    });
  });

  test("apply even with no style prop at all", () => {
    expect(emailStyle("p", undefined).style).toMatchObject({ fontSize: 16 });
    expect(EMAIL_DEFAULTS["p"]).toMatchObject({ lineHeight: 1.5 });
  });
});
