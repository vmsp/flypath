import type { RequestInfo } from "./platform.ts";
import { getRequest } from "./platform.ts";

export type SameSite = "lax" | "none" | "strict";

export type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: SameSite;
  secure?: boolean;
};

export type Cookies = {
  (name: string): string | undefined;
  (): Readonly<Record<string, string>>;
  set: (name: string, value: string, options?: CookieOptions) => void;
  clear: (name: string, options?: CookieOptions) => void;
};

const SAME_SITE: Record<SameSite, string> = {
  lax: "Lax",
  none: "None",
  strict: "Strict",
};

function request(): RequestInfo {
  const value = getRequest();
  if (!value) {
    throw new Error(
      "flypath: cookies() is only available while the flypath router is " +
        "handling a request, so it reads in a middleware, a server " +
        "component or a server action",
    );
  }
  return value;
}

function decode(value: string): string {
  const unquoted =
    value.length > 1 && value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

function parse(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === null) return out;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const name = part.slice(0, at).trim();
    if (name === "") continue;
    out[name] = decode(part.slice(at + 1).trim());
  }
  return out;
}

function serialize(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  let out = `${name}=${encodeURIComponent(value)}`;
  if (options.maxAge !== undefined) {
    out += `; Max-Age=${String(Math.trunc(options.maxAge))}`;
  }
  if (options.expires) out += `; Expires=${options.expires.toUTCString()}`;
  if (options.domain !== undefined) out += `; Domain=${options.domain}`;
  out += `; Path=${options.path ?? "/"}`;
  if (options.sameSite) out += `; SameSite=${SAME_SITE[options.sameSite]}`;
  if (options.secure) out += "; Secure";
  if (options.httpOnly) out += "; HttpOnly";
  return out;
}

function nameOf(line: string): string {
  const at = line.indexOf("=");
  return (at === -1 ? line : line.slice(0, at)).trim();
}

function write(name: string, line: string): void {
  const { outgoing } = request();
  const kept = outgoing
    .getSetCookie()
    .filter((entry) => nameOf(entry) !== name);
  outgoing.delete("set-cookie");
  for (const entry of kept) outgoing.append("set-cookie", entry);
  outgoing.append("set-cookie", line);
}

function expired(line: string): boolean {
  for (const part of line.split(";").slice(1)) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (name === "max-age" && Number(value) <= 0) return true;
    if (name === "expires" && Date.parse(value) <= Date.now()) return true;
  }
  return false;
}

export function mergeCookies(
  header: string | null,
  lines: readonly string[],
): string {
  const jar = parse(header);
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    if (at === -1) continue;
    const name = pair.slice(0, at).trim();
    if (name === "") continue;
    if (expired(line)) delete jar[name];
    else jar[name] = decode(pair.slice(at + 1).trim());
  }
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

const read = (
  name?: string,
): string | undefined | Readonly<Record<string, string>> => {
  const jar = parse(request().headers.get("cookie"));
  return name === undefined ? jar : jar[name];
};

export const cookies: Cookies = Object.assign(read, {
  set: (name: string, value: string, options?: CookieOptions): void => {
    write(name, serialize(name, value, options ?? {}));
  },
  clear: (name: string, options?: CookieOptions): void => {
    write(
      name,
      serialize(name, "", { ...options, expires: new Date(0), maxAge: 0 }),
    );
  },
}) as Cookies;
