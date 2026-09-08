const SKIPPED: ReadonlySet<string> = new Set(["head", "script", "style"]);

const BLOCK: ReadonlySet<string> = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
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
  "li",
  "main",
  "nav",
  "p",
  "pre",
  "section",
  "tr",
]);

const VOID: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  zwnj: "",
};

const ENTITY = /&(#x[\da-f]+|#\d+|[a-z]+);/gi;

function decode(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number(body.slice(1)));
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function collapse(value: string): string {
  return value.replaceAll(/\s+/g, " ");
}

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let at = start; at < html.length; at += 1) {
    const ch = html[at] as string;
    if (quote !== "") {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return at;
  }
  return html.length;
}

function attribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const match = pattern.exec(attributes);
  if (!match) return undefined;
  return decode(match[2] ?? match[3] ?? match[4] ?? "");
}

function hidden(attributes: string): boolean {
  const style = attribute(attributes, "style");
  if (style === undefined) return false;
  return style.replaceAll(/\s+/g, "").includes("display:none");
}

type Link = { href: string; at: number };

export function htmlToText(html: string): string {
  const out: string[] = [];
  let skip: { tag: string; depth: number } | undefined;
  let link: Link | undefined;
  let index = 0;

  const write = (value: string): void => {
    if (value !== "" && !skip) out.push(value);
  };

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      write(collapse(decode(html.slice(index))));
      break;
    }
    if (open > index) write(collapse(decode(html.slice(index, open))));

    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open);
      index = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.startsWith("<!", open)) {
      index = tagEnd(html, open) + 1;
      continue;
    }

    const close = tagEnd(html, open);
    const raw = html.slice(open + 1, close);
    index = close + 1;

    const closing = raw.startsWith("/");
    const name = /^([a-z][a-z\d-]*)/i.exec(closing ? raw.slice(1) : raw);
    if (!name) continue;
    const tag = (name[1] as string).toLowerCase();
    const attributes = (closing ? raw.slice(1) : raw).slice(
      (name[1] as string).length,
    );

    if (skip) {
      if (tag !== skip.tag) continue;
      if (closing) {
        skip.depth -= 1;
        if (skip.depth === 0) skip = undefined;
      } else if (!VOID.has(tag)) {
        skip.depth += 1;
      }
      continue;
    }

    if (!closing && (SKIPPED.has(tag) || hidden(attributes))) {
      if (!VOID.has(tag)) skip = { tag, depth: 1 };
      continue;
    }

    if (tag === "br") {
      out.push("\n");
      continue;
    }
    if (tag === "img" && !closing) {
      const alt = attribute(attributes, "alt");
      if (alt !== undefined && alt !== "") out.push(`[${alt}]`);
      continue;
    }
    if (tag === "a") {
      if (!closing) {
        const href = attribute(attributes, "href");
        link = href === undefined ? undefined : { href, at: out.length };
      } else if (link) {
        const text = out.slice(link.at).join("").trim();
        if (text !== link.href) out.push(` (${link.href})`);
        link = undefined;
      }
      continue;
    }
    if (BLOCK.has(tag)) out.push("\n");
  }

  return `${out
    .join("")
    .replaceAll(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replaceAll(/ {2,}/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}
