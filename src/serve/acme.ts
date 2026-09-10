/**
 * @fileoverview A minimal ACME (RFC 8555) client with `http-01` only.
 *
 * Read the directory, register an account, order the domains, answer one
 * challenge per domain, finalize with a CSR, and write the chain to
 * `<storage>/<domain>/`. Only the cluster primary runs any of it, on a timer
 * rather than on a request.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { ResolvedAcme } from "./config.ts";

export const CHALLENGE_PREFIX = "/.well-known/acme-challenge/";

const challenges = new Map<string, string>();

export function setChallenge(token: string, authorization: string): void {
  challenges.set(token, authorization);
}

export function clearChallenge(token: string): void {
  challenges.delete(token);
}

export function challengeResponse(pathname: string): Response | undefined {
  if (!pathname.startsWith(CHALLENGE_PREFIX)) return undefined;
  const token = pathname.slice(CHALLENGE_PREFIX.length);
  const authorization = challenges.get(token);
  if (authorization === undefined) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(authorization, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return Buffer.from(bytes).toString("base64url");
}

type Jwk = { kty: string; crv: string; x: string; y: string };

/** RFC 7638: SHA-256 of the JWK's required members, in lexicographic order. */
export function thumbprint(jwk: Jwk): string {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  return base64url(crypto.createHash("sha256").update(canonical).digest());
}

/** What the challenge path serves: the CA's token, a dot, and the thumbprint. */
export function keyAuthorization(token: string, jwk: Jwk): string {
  return `${token}.${thumbprint(jwk)}`;
}

type Directory = {
  newNonce: string;
  newAccount: string;
  newOrder: string;
  revokeCert?: string;
  keyChange?: string;
  renewalInfo?: string;
};

type Problem = { type?: string; detail?: string; status?: number };

export type AcmeResult = {
  key: string;
  cert: string;
  notAfter: string;
  domains: string[];
};

/** `meta.json`, so renewal is a function of disk rather than a request. */
export type Meta = {
  domains: string[];
  notAfter: string;
  issuedAt: string;
};

/**
 * True when the certificate is missing, no longer covers the domains asked for,
 * or has less than `renewBefore` days left. ARI (RFC 9773) would replace the
 * arithmetic with the CA's own answer once lifetimes get short enough for the
 * heuristic to be wrong.
 */
export function shouldRenew(
  meta: Meta | undefined,
  domains: readonly string[],
  renewBefore: number,
  now: number = Date.now(),
): boolean {
  if (!meta) return true;
  const wanted = domains.toSorted().join(",");
  if (meta.domains.toSorted().join(",") !== wanted) return true;
  const notAfter = Date.parse(meta.notAfter);
  if (Number.isNaN(notAfter)) return true;
  return notAfter - now < renewBefore * 24 * 60 * 60 * 1000;
}

export function readMeta(storage: string, domain: string): Meta | undefined {
  const file = path.join(storage, domain, "meta.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Meta;
  } catch {
    return undefined;
  }
}

function accountKey(storage: string): crypto.KeyObject {
  const file = path.join(storage, "account.key");
  if (fs.existsSync(file)) {
    return crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
  }
  const { privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file,
    privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    { mode: 0o600 },
  );
  return privateKey;
}

/** Swapped for a stub directory in tests. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type Signed = { protected: string; payload: string; signature: string };

/**
 * The JWS half. Every request is a POST, reads included. RFC 8555 replaced GET
 * with "POST-as-GET", a POST whose payload is the empty string. Each one
 * consumes a nonce and every response hands back the next, so nonces are
 * carried forward rather than fetched, and a rejected one is retried once.
 * `newAccount` signs with the bare `jwk`. Everything after it with the `kid`.
 */
class AcmeClient {
  readonly #directoryUrl: string;
  readonly #fetch: Fetcher;
  readonly #key: crypto.KeyObject;
  readonly #jwk: Jwk;
  #directory: Directory | undefined;
  #nonce: string | undefined;
  #kid: string | undefined;

  constructor(options: {
    directory: string;
    key: crypto.KeyObject;
    fetch?: Fetcher;
  }) {
    this.#directoryUrl = options.directory;
    this.#key = options.key;
    this.#fetch = options.fetch ?? fetch;
    this.#jwk = crypto.createPublicKey(this.#key).export({
      format: "jwk",
    }) as unknown as Jwk;
  }

  get jwk(): Jwk {
    return this.#jwk;
  }

  async directory(): Promise<Directory> {
    if (this.#directory) return this.#directory;
    const response = await this.#fetch(this.#directoryUrl);
    if (!response.ok) {
      throw new Error(
        `flypath: the ACME directory at ${this.#directoryUrl} answered ` +
          String(response.status),
      );
    }
    this.#directory = (await response.json()) as Directory;
    return this.#directory;
  }

  async #nextNonce(): Promise<string> {
    const held = this.#nonce;
    if (held !== undefined) {
      this.#nonce = undefined;
      return held;
    }
    const { newNonce } = await this.directory();
    const response = await this.#fetch(newNonce, { method: "HEAD" });
    const nonce = response.headers.get("replay-nonce");
    if (nonce === null) {
      throw new Error("flypath: the ACME directory returned no Replay-Nonce");
    }
    return nonce;
  }

  #sign(url: string, nonce: string, payload: string): Signed {
    const header = {
      alg: "ES256",
      nonce,
      url,
      ...(this.#kid === undefined ? { jwk: this.#jwk } : { kid: this.#kid }),
    };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = payload === "" ? "" : base64url(payload);
    const signature = crypto.sign(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { key: this.#key, dsaEncoding: "ieee-p1363" },
    );
    return {
      protected: encodedHeader,
      payload: encodedPayload,
      signature: base64url(signature),
    };
  }

  async post(url: string, payload: unknown): Promise<Response> {
    const body = payload === undefined ? "" : JSON.stringify(payload);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nonce = await this.#nextNonce();
      const response = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/jose+json" },
        body: JSON.stringify(this.#sign(url, nonce, body)),
      });

      const replay = response.headers.get("replay-nonce");
      if (replay !== null) this.#nonce = replay;

      if (response.ok) return response;

      const problem = (await response
        .clone()
        .json()
        .catch(() => ({}))) as Problem;

      if (
        problem.type === "urn:ietf:params:acme:error:badNonce" &&
        attempt === 0
      ) {
        continue;
      }

      throw new Error(
        `flypath: ACME ${url} failed with ${String(response.status)} ` +
          `${problem.type ?? "unknown"}${problem.detail ? ` — ${problem.detail}` : ""}`,
      );
    }

    throw new Error(`flypath: ACME ${url} kept rejecting the nonce`);
  }

  async account(email: string): Promise<string> {
    const { newAccount } = await this.directory();
    const response = await this.post(newAccount, {
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`],
    });
    const kid = response.headers.get("location");
    if (kid === null) {
      throw new Error("flypath: newAccount returned no account URL");
    }
    this.#kid = kid;
    return kid;
  }

  async order(domains: readonly string[]): Promise<{
    url: string;
    body: OrderBody;
  }> {
    const { newOrder } = await this.directory();
    const response = await this.post(newOrder, {
      identifiers: domains.map((value) => ({ type: "dns", value })),
    });
    const url = response.headers.get("location");
    if (url === null) {
      throw new Error("flypath: newOrder returned no order URL");
    }
    return { url, body: (await response.json()) as OrderBody };
  }

  async read<T>(url: string): Promise<T> {
    const response = await this.post(url, undefined);
    return (await response.json()) as T;
  }

  async text(url: string): Promise<string> {
    const response = await this.post(url, undefined);
    return await response.text();
  }
}

type Challenge = {
  type: string;
  url: string;
  token: string;
  status: string;
};

type Authorization = {
  status: string;
  identifier: { type: string; value: string };
  challenges: Challenge[];
};

type OrderBody = {
  status: string;
  authorizations: string[];
  finalize: string;
  certificate?: string;
  error?: Problem;
};

const POLL_INTERVAL = 2000;

const POLL_LIMIT = 60;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type CertificateRequest = { der: Uint8Array; pem: string };

/**
 * The one piece delegated to a library, because a malformed CSR fails against
 * a rate-limited service with a generic error. `@peculiar/x509` is an optional
 * peer dependency behind a lazy import, so only `serve.tls.acme` needs it.
 */
export async function createCsr(
  domains: readonly string[],
): Promise<CertificateRequest> {
  let x509: typeof import("@peculiar/x509");
  try {
    await import("reflect-metadata");
    x509 = await import("@peculiar/x509");
  } catch (error) {
    throw new Error(
      "flypath: serve.tls.acme needs @peculiar/x509 to build the certificate " +
        "request — install it with `pnpm add @peculiar/x509 reflect-metadata`",
      { cause: error },
    );
  }

  const webcrypto = crypto.webcrypto as unknown as Crypto;
  x509.cryptoProvider.set(webcrypto);

  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const request = await x509.Pkcs10CertificateRequestGenerator.create({
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.SubjectAlternativeNameExtension(
        domains.map((value) => ({ type: "dns" as const, value })),
      ),
    ],
  });

  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
  const body = Buffer.from(pkcs8)
    .toString("base64")
    .replaceAll(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;

  return { der: new Uint8Array(request.rawData), pem };
}

function notAfterOf(chain: string): string {
  const match =
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(chain);
  if (!match) throw new Error("flypath: the ACME response held no certificate");
  return new crypto.X509Certificate(match[0]).validTo;
}

type Publish = (token: string, authorization: string | null) => void;

export type ObtainOptions = ResolvedAcme & {
  fetch?: Fetcher;
  log?: (message: string) => void;
  publish?: Publish;
};

/**
 * Runs one full order and writes `privkey.pem`, `fullchain.pem` and
 * `meta.json`. Throws when it leaves no certificate.
 */
export async function obtain(options: ObtainOptions): Promise<AcmeResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  const publish: Publish =
    options.publish ??
    ((token, authorization) => {
      if (authorization === null) clearChallenge(token);
      else setChallenge(token, authorization);
    });
  const key = accountKey(options.storage);
  const client = new AcmeClient({
    directory: options.directory,
    key,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  log(`flypath: ACME — registering the account with ${options.directory}`);
  await client.account(options.email);

  log(`flypath: ACME — ordering ${options.domains.join(", ")}`);
  const { url, body } = await client.order(options.domains);

  const published: string[] = [];
  try {
    for (const at of body.authorizations) {
      const authorization = await client.read<Authorization>(at);
      if (authorization.status === "valid") continue;

      const challenge = authorization.challenges.find(
        (entry) => entry.type === "http-01",
      );
      if (!challenge) {
        throw new Error(
          `flypath: ${authorization.identifier.value} offers no http-01 ` +
            "challenge; only http-01 is supported",
        );
      }

      publish(challenge.token, keyAuthorization(challenge.token, client.jwk));
      published.push(challenge.token);

      log(
        `flypath: ACME — answering http-01 for ${authorization.identifier.value}`,
      );
      await client.post(challenge.url, {});

      let state = await client.read<Authorization>(at);
      for (let poll = 0; poll < POLL_LIMIT; poll += 1) {
        if (state.status === "valid") break;
        if (state.status === "invalid") {
          throw new Error(
            `flypath: ACME could not validate ${state.identifier.value}; the ` +
              "domain must resolve to this host and port 80 must reach it",
          );
        }
        await wait(POLL_INTERVAL);
        state = await client.read<Authorization>(at);
      }
      if (state.status !== "valid") {
        throw new Error(
          `flypath: ACME validation for ${state.identifier.value} timed out`,
        );
      }
    }

    log("flypath: ACME — finalizing the order");
    const { der, pem } = await createCsr(options.domains);
    await client.post(body.finalize, {
      csr: Buffer.from(der).toString("base64url"),
    });

    let order = await client.read<OrderBody>(url);
    for (
      let poll = 0;
      poll < POLL_LIMIT && order.status !== "valid";
      poll += 1
    ) {
      if (order.status === "invalid") {
        throw new Error(
          `flypath: the ACME order failed — ${order.error?.detail ?? "no detail"}`,
        );
      }
      await wait(POLL_INTERVAL);
      order = await client.read<OrderBody>(url);
    }
    if (order.certificate === undefined) {
      throw new Error("flypath: the ACME order never produced a certificate");
    }

    log("flypath: ACME — downloading the chain");
    const chain = await client.text(order.certificate);
    const notAfter = notAfterOf(chain);

    const primary = options.domains[0];
    if (primary === undefined) throw new Error("flypath: no domain to store");
    const dir = path.join(options.storage, primary);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(path.join(dir, "privkey.pem"), pem, { mode: 0o600 });
    await fsp.writeFile(path.join(dir, "fullchain.pem"), chain, {
      mode: 0o644,
    });
    await fsp.writeFile(
      path.join(dir, "meta.json"),
      `${JSON.stringify(
        {
          domains: [...options.domains],
          notAfter: new Date(notAfter).toISOString(),
          issuedAt: new Date().toISOString(),
        } satisfies Meta,
        null,
        2,
      )}\n`,
    );

    log(
      `flypath: ACME — certificate stored in ${dir}, valid until ${notAfter}`,
    );
    return {
      key: pem,
      cert: chain,
      notAfter: new Date(notAfter).toISOString(),
      domains: [...options.domains],
    };
  } finally {
    for (const token of published) publish(token, null);
  }
}

export type Lock = { release: () => void };

/**
 * Keeps two servers on a shared volume from ordering at once. A lock older
 * than ten minutes is assumed to belong to a process that died.
 */
export function acquire(storage: string): Lock | undefined {
  const file = path.join(storage, "issue.lock");
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  try {
    const handle = fs.openSync(file, "wx");
    fs.writeFileSync(handle, String(process.pid));
    fs.closeSync(handle);
  } catch {
    try {
      const stale = Date.now() - fs.statSync(file).mtimeMs > 10 * 60 * 1000;
      if (!stale) return undefined;
      fs.unlinkSync(file);
      return acquire(storage);
    } catch {
      return undefined;
    }
  }
  return {
    release: () => {
      try {
        fs.unlinkSync(file);
      } catch {
        console.warn(`flypath: could not release the ACME lock at ${file}`);
      }
    },
  };
}
