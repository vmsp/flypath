export type PlistValue =
  | string
  | number
  | boolean
  | PlistRaw
  | PlistValue[]
  | { [key: string]: PlistValue };

type PlistRaw = { tag: string; text: string };

const ENTITIES: Array<[string, string]> = [
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
];

function decode(value: string): string {
  let output = value;
  for (const [from, to] of ENTITIES) output = output.replaceAll(from, to);
  return output;
}

function encode(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

type Cursor = { text: string; at: number };

function skip(cursor: Cursor): void {
  while (cursor.at < cursor.text.length) {
    if (/\s/.test(cursor.text[cursor.at] ?? "")) {
      cursor.at += 1;
      continue;
    }
    if (cursor.text.startsWith("<!--", cursor.at)) {
      const end = cursor.text.indexOf("-->", cursor.at);
      cursor.at = end === -1 ? cursor.text.length : end + 3;
      continue;
    }
    return;
  }
}

function openTag(cursor: Cursor): { name: string; empty: boolean } {
  skip(cursor);
  if (cursor.text[cursor.at] !== "<") {
    throw new Error(`flypath: malformed plist at offset ${cursor.at}`);
  }
  const end = cursor.text.indexOf(">", cursor.at);
  if (end === -1) throw new Error("flypath: malformed plist");
  const body = cursor.text.slice(cursor.at + 1, end);
  cursor.at = end + 1;
  const empty = body.endsWith("/");
  const name = (empty ? body.slice(0, -1) : body).trim().split(/\s/)[0] ?? "";
  return { name, empty };
}

function textUntilClose(cursor: Cursor, name: string): string {
  const close = `</${name}>`;
  const end = cursor.text.indexOf(close, cursor.at);
  if (end === -1) throw new Error(`flypath: unclosed <${name}> in plist`);
  const body = cursor.text.slice(cursor.at, end);
  cursor.at = end + close.length;
  return body;
}

function peekClose(cursor: Cursor, name: string): boolean {
  skip(cursor);
  return cursor.text.startsWith(`</${name}>`, cursor.at);
}

function readValue(cursor: Cursor): PlistValue {
  const { name, empty } = openTag(cursor);

  if (name === "true") return true;
  if (name === "false") return false;
  if (empty) return name === "array" ? [] : name === "dict" ? {} : "";

  if (name === "dict") {
    const value: Record<string, PlistValue> = {};
    while (!peekClose(cursor, "dict")) {
      const key = openTag(cursor);
      if (key.name !== "key") {
        throw new Error("flypath: expected <key> in plist <dict>");
      }
      value[decode(textUntilClose(cursor, "key"))] = readValue(cursor);
    }
    cursor.at += "</dict>".length;
    return value;
  }

  if (name === "array") {
    const value: PlistValue[] = [];
    while (!peekClose(cursor, "array")) value.push(readValue(cursor));
    cursor.at += "</array>".length;
    return value;
  }

  const body = decode(textUntilClose(cursor, name));
  if (name === "string") return body;
  if (name === "integer" || name === "real") return Number(body);
  return { tag: name, text: body };
}

export function parsePlist(source: string): PlistValue {
  const start = source.indexOf("<plist");
  if (start === -1) throw new Error("flypath: missing <plist> element");
  const cursor: Cursor = { text: source, at: source.indexOf(">", start) + 1 };
  return readValue(cursor);
}

function isRaw(value: PlistValue): value is PlistRaw {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as PlistRaw).tag === "string" &&
    typeof (value as PlistRaw).text === "string"
  );
}

function isDict(value: PlistValue): value is Record<string, PlistValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isRaw(value)
  );
}

function write(value: PlistValue, depth: number): string {
  const pad = "\t".repeat(depth);

  if (typeof value === "boolean") return `${pad}<${value}/>\n`;
  if (typeof value === "string")
    return `${pad}<string>${encode(value)}</string>\n`;
  if (typeof value === "number") {
    const tag = Number.isInteger(value) ? "integer" : "real";
    return `${pad}<${tag}>${value}</${tag}>\n`;
  }
  if (isRaw(value)) {
    return `${pad}<${value.tag}>${encode(value.text)}</${value.tag}>\n`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>\n`;
    const body = value.map((entry) => write(entry, depth + 1)).join("");
    return `${pad}<array>\n${body}${pad}</array>\n`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return `${pad}<dict/>\n`;
  const body = keys
    .map(
      (key) =>
        `${pad}\t<key>${encode(key)}</key>\n${write(value[key] as PlistValue, depth + 1)}`,
    )
    .join("");
  return `${pad}<dict>\n${body}${pad}</dict>\n`;
}

export function formatPlist(value: PlistValue): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${write(value, 0)}</plist>
`;
}

export function mergePlist(base: PlistValue, over: PlistValue): PlistValue {
  if (!isDict(base) || !isDict(over)) return over;
  const merged: Record<string, PlistValue> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const existing = merged[key];
    merged[key] = existing === undefined ? value : mergePlist(existing, value);
  }
  return merged;
}
