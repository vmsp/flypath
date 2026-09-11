import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export type Peer = {
  proto: string | undefined;
  host: string | undefined;
  address: string | undefined;
};

type Forwarding = {
  proto: string | undefined;
  host: string | undefined;
  chain: string[];
};

function bytes(text: string): Uint8Array | undefined {
  const value = text.trim().replaceAll(/^\[|\]$/g, "");
  if (value === "") return undefined;

  if (!value.includes(":")) {
    const parts = value.split(".");
    if (parts.length !== 4) return undefined;
    const out = new Uint8Array(16);
    out[10] = 0xff;
    out[11] = 0xff;
    for (const [at, part] of parts.entries()) {
      if (!/^\d{1,3}$/.test(part)) return undefined;
      const octet = Number(part);
      if (octet > 255) return undefined;
      out[12 + at] = octet;
    }
    return out;
  }

  const mapped = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
  let head = value;
  let tail: Uint8Array | undefined;
  if (mapped?.[1] !== undefined && mapped[2] !== undefined) {
    const four = bytes(mapped[2]);
    if (!four) return undefined;
    tail = four.slice(12);
    head = mapped[1].slice(0, -1);
  }

  const halves = head.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] === "" ? [] : (halves[0]?.split(":") ?? []);
  const second = halves[1];
  const right = second === undefined || second === "" ? [] : second.split(":");

  const groups: number[] = [];
  for (const group of left) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    groups.push(Number.parseInt(group, 16));
  }
  const suffix: number[] = [];
  for (const group of right) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return undefined;
    suffix.push(Number.parseInt(group, 16));
  }

  const total = 8 - (tail ? 2 : 0);
  const missing = total - groups.length - suffix.length;
  if (halves.length === 2) {
    if (missing < 0) return undefined;
    for (let at = 0; at < missing; at += 1) groups.push(0);
  } else if (missing !== 0) {
    return undefined;
  }
  groups.push(...suffix);

  const out = new Uint8Array(16);
  for (const [at, group] of groups.entries()) {
    out[at * 2] = group >> 8;
    out[at * 2 + 1] = group & 0xff;
  }
  if (tail) out.set(tail, 12);
  return out;
}

type Range = { network: Uint8Array; prefix: number };

function range(text: string): Range | undefined {
  const [address, mask] = text.trim().split("/");
  if (address === undefined) return undefined;
  const network = bytes(address);
  if (!network) return undefined;
  const four = !address.includes(":");
  if (mask === undefined) return { network, prefix: 128 };
  const size = Number(mask);
  if (!Number.isInteger(size) || size < 0) return undefined;
  if (four) {
    if (size > 32) return undefined;
    return { network, prefix: 96 + size };
  }
  if (size > 128) return undefined;
  return { network, prefix: size };
}

function within(address: Uint8Array, entry: Range): boolean {
  const whole = entry.prefix >> 3;
  for (let at = 0; at < whole; at += 1) {
    if (address[at] !== entry.network[at]) return false;
  }
  const rest = entry.prefix & 7;
  if (rest === 0) return true;
  const mask = 0xff << (8 - rest);
  return (
    ((address[whole] ?? 0) & mask) === ((entry.network[whole] ?? 0) & mask)
  );
}

export type Trust = (address: string | undefined) => boolean;

export function trustPredicate(
  setting: boolean | number | string[] | undefined,
): Trust {
  if (setting === undefined || setting === false) return () => false;
  if (setting === true || typeof setting === "number") return () => true;

  const ranges = setting
    .map((entry) => range(entry))
    .filter((entry): entry is Range => entry !== undefined);

  return (address) => {
    if (address === undefined) return false;
    const parsed = bytes(address);
    if (!parsed) return false;
    return ranges.some((entry) => within(parsed, entry));
  };
}

function directives(value: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of value.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    let raw = part.slice(at + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) {
      raw = raw.slice(1, -1);
    }
    out.set(key, raw);
  }
  return out;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const all = Array.isArray(value) ? value : [value];
  return all
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function collect(req: IncomingMessage): Forwarding {
  const standard = list(req.headers["forwarded"]);
  if (standard.length > 0) {
    const parsed = standard.map((entry) => directives(entry));
    const chain = parsed
      .map((entry) => entry.get("for"))
      .filter((entry): entry is string => entry !== undefined)
      .map((entry) => entry.replaceAll(/^\[|\]$/g, "").replace(/:\d+$/, ""));
    const first = parsed[0];
    return {
      proto: first?.get("proto"),
      host: first?.get("host"),
      chain,
    };
  }

  return {
    proto: list(req.headers["x-forwarded-proto"])[0],
    host: list(req.headers["x-forwarded-host"])[0],
    chain: list(req.headers["x-forwarded-for"]),
  };
}

export function resolvePeer(
  req: IncomingMessage,
  trustProxy: boolean | number | string[],
  trust: Trust = trustPredicate(trustProxy),
): Peer {
  const socket = req.socket.remoteAddress;
  if (!trust(socket)) {
    return { proto: undefined, host: undefined, address: socket };
  }

  const { proto, host, chain } = collect(req);

  let address = socket;
  if (chain.length > 0) {
    if (typeof trustProxy === "number") {
      address = chain[chain.length - trustProxy] ?? chain[0] ?? socket;
    } else if (trustProxy === true) {
      address = chain[0] ?? socket;
    } else {
      address = socket;
      for (let at = chain.length - 1; at >= 0; at -= 1) {
        const entry = chain[at];
        if (entry === undefined) continue;
        if (trust(entry)) continue;
        address = entry;
        break;
      }
    }
  }

  return { proto, host, address };
}

function authority(req: IncomingMessage, peer: Peer, fallback: string): string {
  const host = peer.host ?? req.headers["host"];
  if (typeof host === "string" && host !== "") return host;
  return fallback;
}

export type AdapterOptions = {
  secure: boolean;
  trustProxy: boolean | number | string[];
  trust?: Trust;
  host?: string;
};

export type Incoming = {
  request: Request;
  peer: Peer;
  controller: AbortController;
};

const NO_BODY: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function toRequest(
  req: IncomingMessage,
  options: AdapterOptions,
): Incoming {
  const trust = options.trust ?? trustPredicate(options.trustProxy);
  const peer = resolvePeer(req, options.trustProxy, trust);
  const scheme =
    peer.proto?.split(",")[0]?.trim() || (options.secure ? "https" : "http");
  const url = `${scheme}://${authority(req, peer, options.host ?? "localhost")}${req.url ?? "/"}`;

  const headers = new Headers();
  for (let at = 0; at < req.rawHeaders.length; at += 2) {
    const key = req.rawHeaders[at];
    const value = req.rawHeaders[at + 1];
    if (key === undefined || value === undefined) continue;
    try {
      headers.append(key, value);
    } catch {
      continue;
    }
  }

  const method = req.method ?? "GET";
  const controller = new AbortController();
  const abort = (): void => {
    if (!req.readableEnded) controller.abort();
  };
  req.once("aborted", abort);
  req.once("close", abort);

  const body = NO_BODY.has(method)
    ? undefined
    : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>);

  const request = new Request(url, {
    method,
    headers,
    signal: controller.signal,
    ...(body === undefined ? {} : { body, duplex: "half" }),
  } as RequestInit);

  return { request, peer, controller };
}

export async function sendResponse(
  res: ServerResponse,
  response: Response,
  head = false,
): Promise<void> {
  if (res.writableEnded || res.destroyed) {
    await response.body?.cancel().catch(() => {});
    return;
  }

  for (const [key, value] of response.headers) {
    if (key === "set-cookie") continue;
    res.setHeader(key, value);
  }
  const jar = response.headers.getSetCookie();
  if (jar.length > 0) res.setHeader("set-cookie", jar);

  res.writeHead(response.status, response.statusText || undefined);

  if (head || !response.body) {
    await response.body?.cancel().catch(() => {});
    res.end();
    return;
  }

  const source = Readable.fromWeb(
    response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      source.on("error", reject);
      res.on("error", reject);
      res.on("close", () => {
        if (res.writableEnded) resolve();
        else reject(new Error("The connection closed mid-response"));
      });
      source.pipe(res);
      res.on("finish", resolve);
    });
  } catch (error) {
    source.destroy();
    if (!res.writableEnded) res.destroy();
    throw error;
  }
}
