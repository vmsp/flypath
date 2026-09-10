import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bundle": "application/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".flight": "text/x-component;charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html;charset=utf-8",
  ".html": "text/html;charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".jsbundle": "application/javascript;charset=utf-8",
  ".map": "application/json;charset=utf-8",
  ".mjs": "text/javascript;charset=utf-8",
  ".mp4": "video/mp4",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain;charset=utf-8",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

const REVALIDATE = "public, max-age=0, must-revalidate";

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export function cacheControl(relative: string): string {
  const at = relative.replaceAll("\\", "/");
  if (at.startsWith("assets/") || at.startsWith("chunk/")) return IMMUTABLE;
  return REVALIDATE;
}

function etagOf(stats: fs.Stats): string {
  const size = stats.size.toString(16);
  const time = Math.floor(stats.mtimeMs).toString(16);
  return `W/"${size}-${time}"`;
}

export type Found = {
  file: string;
  relative: string;
  stats: fs.Stats;
};

function statFile(file: string): fs.Stats | undefined {
  try {
    const stats = fs.statSync(file);
    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

function inside(dir: string, file: string): boolean {
  const relative = path.relative(dir, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

const roots = new Map<string, string>();

function realRoot(dir: string): string {
  const held = roots.get(dir);
  if (held !== undefined) return held;
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    real = dir;
  }
  roots.set(dir, real);
  return real;
}

export function resolveFile(dir: string, pathname: string): Found | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;

  const target = path.resolve(dir, `.${path.posix.normalize(decoded)}`);
  if (!inside(dir, target)) return undefined;

  const candidates = decoded.endsWith("/")
    ? [path.join(target, "index.html")]
    : [target, path.join(target, "index.html")];

  for (const candidate of candidates) {
    const stats = statFile(candidate);
    if (!stats) continue;
    let real: string;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    if (!inside(dir, real) && !inside(realRoot(dir), real)) continue;
    return {
      file: candidate,
      relative: path.relative(dir, candidate),
      stats,
    };
  }

  return undefined;
}

const ENCODINGS: readonly { suffix: string; token: string }[] = [
  { suffix: ".br", token: "br" },
  { suffix: ".gz", token: "gzip" },
];

function accepts(header: string | null): Set<string> {
  const out = new Set<string>();
  if (!header) return out;
  for (const part of header.split(",")) {
    const [name, ...rest] = part.split(";");
    const token = name?.trim().toLowerCase();
    if (!token) continue;
    const quality = rest
      .map((entry) => /^\s*q=([\d.]+)\s*$/.exec(entry))
      .find((match) => match !== null);
    if (quality && Number(quality[1]) === 0) continue;
    out.add(token);
  }
  return out;
}

function encoded(
  found: Found,
  header: string | null,
): {
  file: string;
  stats: fs.Stats;
  encoding: string | undefined;
} {
  const wanted = accepts(header);
  for (const { suffix, token } of ENCODINGS) {
    if (!wanted.has(token)) continue;
    const sidecar = found.file + suffix;
    const stats = statFile(sidecar);
    if (!stats) continue;
    return { file: sidecar, stats, encoding: token };
  }
  return { file: found.file, stats: found.stats, encoding: undefined };
}

type Slice = { start: number; end: number } | "unsatisfiable" | undefined;

export function parseRange(header: string | null, size: number): Slice {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, from, to] = match;
  if (from === "" && to === "") return "unsatisfiable";

  let start: number;
  let end: number;
  if (from === "") {
    const length = Number(to);
    if (length <= 0) return "unsatisfiable";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

function stream(file: string, start?: number, end?: number): ReadableStream {
  const source = fs.createReadStream(
    file,
    start === undefined ? {} : { start, end },
  );
  return Readable.toWeb(source) as unknown as ReadableStream;
}

function fresh(request: Request, tag: string, modified: Date): boolean {
  const match = request.headers.get("if-none-match");
  if (match !== null) {
    const tokens = match.split(",").map((entry) => entry.trim());
    const bare = tag.replace(/^W\//, "");
    return tokens.some(
      (entry) => entry === "*" || entry.replace(/^W\//, "") === bare,
    );
  }
  const since = request.headers.get("if-modified-since");
  if (since === null) return false;
  const at = Date.parse(since);
  if (Number.isNaN(at)) return false;
  return Math.floor(modified.getTime() / 1000) <= Math.floor(at / 1000);
}

export type StaticOptions = {
  dir: string;
  compress: boolean;
};

export function serveStatic(
  request: Request,
  options: StaticOptions,
): Response | undefined {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") return undefined;
  for (const [key] of request.headers) {
    if (key.toLowerCase().startsWith("x-flypath-")) return undefined;
  }

  const url = new URL(request.url);
  const found = resolveFile(options.dir, url.pathname);
  if (!found) return undefined;

  const chosen = options.compress
    ? encoded(found, request.headers.get("accept-encoding"))
    : { file: found.file, stats: found.stats, encoding: undefined };

  const tag = etagOf(chosen.stats);
  const modified = new Date(chosen.stats.mtimeMs);
  const headers = new Headers({
    "content-type": contentType(found.file),
    "cache-control": cacheControl(found.relative),
    etag: tag,
    "last-modified": modified.toUTCString(),
    "accept-ranges": "bytes",
  });
  if (chosen.encoding !== undefined) {
    headers.set("content-encoding", chosen.encoding);
  }
  if (options.compress) headers.set("vary", "Accept-Encoding");

  if (fresh(request, tag, modified)) {
    return new Response(null, { status: 304, headers });
  }

  const size = chosen.stats.size;
  const ifRange = request.headers.get("if-range");
  const rangeable = ifRange === null || ifRange === tag;
  const slice = rangeable
    ? parseRange(request.headers.get("range"), size)
    : undefined;

  if (slice === "unsatisfiable") {
    headers.set("content-range", `bytes */${String(size)}`);
    return new Response(null, { status: 416, headers });
  }

  if (slice) {
    const length = slice.end - slice.start + 1;
    headers.set("content-length", String(length));
    headers.set(
      "content-range",
      `bytes ${String(slice.start)}-${String(slice.end)}/${String(size)}`,
    );
    return new Response(
      method === "HEAD" ? null : stream(chosen.file, slice.start, slice.end),
      { status: 206, headers },
    );
  }

  headers.set("content-length", String(size));
  return new Response(method === "HEAD" ? null : stream(chosen.file), {
    status: 200,
    headers,
  });
}
