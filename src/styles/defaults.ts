export const RESET = `*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
dialog { margin: auto; }
html { font-family: system-ui, sans-serif; }
:root { color-scheme: light dark; }
body { line-height: 1.5; -webkit-font-smoothing: antialiased; }
img, picture, video, canvas, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; }
p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
p { text-wrap: pretty; }
h1, h2, h3, h4, h5, h6 { text-wrap: balance; }`;

export const ROOT_FONT_SIZE = 16;

export const TAGS = [
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "button",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "i",
  "img",
  "input",
  "label",
  "main",
  "nav",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "strong",
  "textarea",
] as const;

export type Tag = (typeof TAGS)[number];

export type TagDefaults = {
  text: boolean;
  role?: string;
  style: Record<string, string | number>;
};

const heading = (size: number): TagDefaults => ({
  text: true,
  role: "heading",
  style: { fontSize: size, fontWeight: "700", lineHeight: size * 1.5 },
});

const container = (role?: string): TagDefaults => ({
  text: false,
  ...(role === undefined ? {} : { role }),
  style: {},
});

const text = (style: Record<string, string | number> = {}): TagDefaults => ({
  text: true,
  style,
});

export const TAG_DEFAULTS: Record<Tag, TagDefaults> = {
  a: {
    text: true,
    role: "link",
    style: { color: "#0000ee", textDecorationLine: "underline" },
  },
  article: container("article"),
  aside: container("complementary"),
  b: text({ fontWeight: "700" }),
  blockquote: container(),
  button: container("button"),
  code: text({ fontFamily: "monospace" }),
  div: container(),
  em: text({ fontStyle: "italic" }),
  figcaption: container(),
  figure: container("figure"),
  footer: container("contentinfo"),
  form: container("form"),
  h1: heading(32),
  h2: heading(24),
  h3: heading(18.72),
  h4: heading(16),
  h5: heading(13.28),
  h6: heading(10.72),
  header: container("banner"),
  i: text({ fontStyle: "italic" }),
  img: { text: false, role: "image", style: {} },
  input: text(),
  label: text(),
  main: container("main"),
  nav: container("navigation"),
  p: text({ fontSize: 16, lineHeight: 24 }),
  pre: text({ fontFamily: "monospace" }),
  section: container("region"),
  small: text({ fontSize: 12.8, lineHeight: 19.2 }),
  span: text(),
  strong: text({ fontWeight: "700" }),
  textarea: text(),
};

export const INHERITED_ROOT: Record<string, string | number> = {
  fontSize: ROOT_FONT_SIZE,
  lineHeight: ROOT_FONT_SIZE * 1.5,
};

export const FLEX_DEFAULTS: Record<string, string | number> = {
  alignContent: "stretch",
  flexDirection: "row",
  flexShrink: 1,
};
