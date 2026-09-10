import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Fetcher, Meta } from "../../src/serve/acme.ts";
import {
  CHALLENGE_PREFIX,
  challengeResponse,
  keyAuthorization,
  obtain,
  shouldRenew,
  thumbprint,
} from "../../src/serve/acme.ts";

let storage: string;

beforeEach(() => {
  storage = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-acme-"));
});

afterEach(() => {
  fs.rmSync(storage, { recursive: true, force: true });
});

const BASE = "https://acme.test";

type Header = {
  alg: string;
  nonce: string;
  url: string;
  jwk?: { kty: string; crv: string; x: string; y: string };
  kid?: string;
};

async function selfSigned(days: number): Promise<string> {
  await import("reflect-metadata");
  const x509 = await import("@peculiar/x509");
  const webcrypto = crypto.webcrypto as unknown as Crypto;
  x509.cryptoProvider.set(webcrypto);
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=example.com",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  return certificate.toString("pem");
}

type Trace = {
  nonces: string[];
  reused: number;
  headers: Header[];
  authorization: string | undefined;
  served: string | undefined;
};

function stub(options: {
  chain: string;
  domains: string[];
  failNonceOnce?: boolean;
}): { fetch: Fetcher; trace: Trace } {
  const trace: Trace = {
    nonces: [],
    reused: 0,
    headers: [],
    authorization: undefined,
    served: undefined,
  };

  const live = new Set<string>();
  const validated = new Set<string>();
  let issued = 0;
  let finalized = false;
  let failed = options.failNonceOnce ?? false;

  const mint = (): string => {
    issued += 1;
    const nonce = `nonce-${String(issued)}`;
    live.add(nonce);
    trace.nonces.push(nonce);
    return nonce;
  };

  const answer = (body: unknown, init: ResponseInit = {}): Response => {
    const headers = new Headers(init.headers);
    headers.set("replay-nonce", mint());
    headers.set("content-type", "application/json");
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        ...init,
        headers,
      },
    );
  };

  const problem = (type: string): Response =>
    answer({ type, detail: type }, { status: 400 });

  const fetcher: Fetcher = async (url, init) => {
    if (url === `${BASE}/directory`) {
      return new Response(
        JSON.stringify({
          newNonce: `${BASE}/new-nonce`,
          newAccount: `${BASE}/new-account`,
          newOrder: `${BASE}/new-order`,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (init?.method === "HEAD") {
      return new Response(null, { headers: { "replay-nonce": mint() } });
    }

    const jws = JSON.parse(String(init?.body)) as {
      protected: string;
      payload: string;
    };
    const header = JSON.parse(
      Buffer.from(jws.protected, "base64url").toString("utf8"),
    ) as Header;
    trace.headers.push(header);

    if (!live.delete(header.nonce)) {
      trace.reused += 1;
      return problem("urn:ietf:params:acme:error:badNonce");
    }
    if (header.url !== url)
      return problem("urn:ietf:params:acme:error:malformed");

    const payload =
      jws.payload === ""
        ? undefined
        : (JSON.parse(
            Buffer.from(jws.payload, "base64url").toString("utf8"),
          ) as Record<string, unknown> | undefined);

    if (url === `${BASE}/new-account`) {
      return answer(
        { status: "valid" },
        { status: 201, headers: { location: `${BASE}/account/1` } },
      );
    }

    if (url === `${BASE}/new-order`) {
      if (failed) {
        failed = false;
        return problem("urn:ietf:params:acme:error:badNonce");
      }
      return answer(
        {
          status: "pending",
          authorizations: options.domains.map(
            (domain) => `${BASE}/authz/${domain}`,
          ),
          finalize: `${BASE}/finalize`,
        },
        { status: 201, headers: { location: `${BASE}/order/1` } },
      );
    }

    if (url.startsWith(`${BASE}/authz/`)) {
      const domain = url.slice(`${BASE}/authz/`.length);
      return answer({
        status: validated.has(domain) ? "valid" : "pending",
        identifier: { type: "dns", value: domain },
        challenges: [
          {
            type: "dns-01",
            url: `${BASE}/chall/dns/${domain}`,
            token: `dns-${domain}`,
            status: "pending",
          },
          {
            type: "http-01",
            url: `${BASE}/chall/http/${domain}`,
            token: `token-${domain}`,
            status: "pending",
          },
        ],
      });
    }

    if (url.startsWith(`${BASE}/chall/http/`)) {
      const domain = url.slice(`${BASE}/chall/http/`.length);
      const response = challengeResponse(`${CHALLENGE_PREFIX}token-${domain}`);
      trace.served = response ? await response.text() : undefined;
      validated.add(domain);
      return answer({ status: "processing" });
    }

    if (url === `${BASE}/finalize`) {
      trace.authorization = String(payload?.["csr"]);
      finalized = true;
      return answer({ status: "processing" });
    }

    if (url === `${BASE}/order/1`) {
      return answer(
        finalized
          ? {
              status: "valid",
              authorizations: [],
              finalize: `${BASE}/finalize`,
              certificate: `${BASE}/cert/1`,
            }
          : {
              status: "processing",
              authorizations: [],
              finalize: `${BASE}/finalize`,
            },
      );
    }

    if (url === `${BASE}/cert/1`) return answer(options.chain);

    return new Response("not found", { status: 404 });
  };

  return { fetch: fetcher, trace };
}

function alwaysInvalid(fetcher: Fetcher): Fetcher {
  return async (url, init) => {
    if (!url.startsWith(`${BASE}/authz/`)) return fetcher(url, init);
    return new Response(
      JSON.stringify({
        status: "invalid",
        identifier: { type: "dns", value: "example.com" },
        challenges: [
          {
            type: "http-01",
            url: `${BASE}/chall/http/example.com`,
            token: "token-example.com",
            status: "invalid",
          },
        ],
      }),
      {
        headers: {
          "replay-nonce": `late-${String(Math.random())}`,
          "content-type": "application/json",
        },
      },
    );
  };
}

describe("obtain", () => {
  test("runs the whole order and writes the certificate", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher, trace } = stub({
      chain,
      domains: ["example.com", "www.example.com"],
    });

    const result = await obtain({
      email: "ops@example.com",
      domains: ["example.com", "www.example.com"],
      directory: `${BASE}/directory`,
      storage,
      renewBefore: 30,
      fetch: fetcher,
      log: () => undefined,
    });

    expect(result.domains).toEqual(["example.com", "www.example.com"]);
    expect(
      fs.existsSync(path.join(storage, "example.com", "privkey.pem")),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(storage, "example.com", "fullchain.pem"),
        "utf8",
      ),
    ).toContain("BEGIN CERTIFICATE");
    const meta = JSON.parse(
      fs.readFileSync(path.join(storage, "example.com", "meta.json"), "utf8"),
    ) as Meta;
    expect(meta.domains).toEqual(["example.com", "www.example.com"]);
    expect(Date.parse(meta.notAfter)).toBeGreaterThan(Date.now());
    expect(trace.authorization).toBeTruthy();
  });

  test("carries a jwk on newAccount and a kid on everything after", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher, trace } = stub({ chain, domains: ["example.com"] });

    await obtain({
      email: "ops@example.com",
      domains: ["example.com"],
      directory: `${BASE}/directory`,
      storage,
      renewBefore: 30,
      fetch: fetcher,
      log: () => undefined,
    });

    const [first, ...rest] = trace.headers;
    expect(first?.jwk).toBeTruthy();
    expect(first?.kid).toBeUndefined();
    expect(rest.length).toBeGreaterThan(0);
    for (const header of rest) {
      expect(header.kid).toBe(`${BASE}/account/1`);
      expect(header.jwk).toBeUndefined();
      expect(header.alg).toBe("ES256");
    }
  });

  test("never reuses a nonce", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher, trace } = stub({ chain, domains: ["example.com"] });

    await obtain({
      email: "ops@example.com",
      domains: ["example.com"],
      directory: `${BASE}/directory`,
      storage,
      renewBefore: 30,
      fetch: fetcher,
      log: () => undefined,
    });

    expect(trace.reused).toBe(0);
    const used = trace.headers.map((header) => header.nonce);
    expect(new Set(used).size).toBe(used.length);
  });

  test("retries once when the server rejects the nonce", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher } = stub({
      chain,
      domains: ["example.com"],
      failNonceOnce: true,
    });

    await expect(
      obtain({
        email: "ops@example.com",
        domains: ["example.com"],
        directory: `${BASE}/directory`,
        storage,
        renewBefore: 30,
        fetch: fetcher,
        log: () => undefined,
      }),
    ).resolves.toBeTruthy();
  });

  test("publishes the key authorization for the http-01 token", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher, trace } = stub({ chain, domains: ["example.com"] });

    const published: [string, string | null][] = [];
    await obtain({
      email: "ops@example.com",
      domains: ["example.com"],
      directory: `${BASE}/directory`,
      storage,
      renewBefore: 30,
      fetch: fetcher,
      log: () => undefined,
      publish: (token, authorization) => {
        published.push([token, authorization]);
      },
    });

    expect(published[0]?.[0]).toBe("token-example.com");
    expect(published[0]?.[1]).toMatch(/^token-example\.com\.[\w-]+$/);
    expect(published.at(-1)).toEqual(["token-example.com", null]);
    expect(trace.served).toBe("Not Found");
  });

  test("serves the key authorization off the challenge path by default", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher, trace } = stub({ chain, domains: ["example.com"] });

    await obtain({
      email: "ops@example.com",
      domains: ["example.com"],
      directory: `${BASE}/directory`,
      storage,
      renewBefore: 30,
      fetch: fetcher,
      log: () => undefined,
    });

    expect(trace.served).toMatch(/^token-example\.com\./);
    expect(
      challengeResponse(`${CHALLENGE_PREFIX}token-example.com`)?.status,
    ).toBe(404);
  });

  test("fails loudly when validation never succeeds", async () => {
    const chain = await selfSigned(90);
    const { fetch: fetcher } = stub({ chain, domains: ["example.com"] });

    const wrapped = alwaysInvalid(fetcher);

    await expect(
      obtain({
        email: "ops@example.com",
        domains: ["example.com"],
        directory: `${BASE}/directory`,
        storage,
        renewBefore: 30,
        fetch: wrapped,
        log: () => undefined,
      }),
    ).rejects.toThrow(/could not validate example\.com/);
  });
});

describe("keyAuthorization", () => {
  test("is the token, a dot, and the account thumbprint", () => {
    const jwk = { kty: "EC", crv: "P-256", x: "abc", y: "def" };
    expect(keyAuthorization("tok", jwk)).toBe(`tok.${thumbprint(jwk)}`);
  });

  test("hashes the canonical member ordering only", () => {
    const a = { kty: "EC", crv: "P-256", x: "abc", y: "def" };
    const b = { y: "def", x: "abc", crv: "P-256", kty: "EC" };
    expect(thumbprint(a)).toBe(thumbprint(b));
  });
});

describe("shouldRenew", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 0, 1);
  const meta = (days: number, domains: string[] = ["example.com"]): Meta => ({
    domains,
    notAfter: new Date(now + days * day).toISOString(),
    issuedAt: new Date(now).toISOString(),
  });

  test("renews when nothing is on disk", () => {
    expect(shouldRenew(undefined, ["example.com"], 30, now)).toBe(true);
  });

  test("renews inside the window and not outside it", () => {
    expect(shouldRenew(meta(60), ["example.com"], 30, now)).toBe(false);
    expect(shouldRenew(meta(31), ["example.com"], 30, now)).toBe(false);
    expect(shouldRenew(meta(29), ["example.com"], 30, now)).toBe(true);
    expect(shouldRenew(meta(-1), ["example.com"], 30, now)).toBe(true);
  });

  test("renews when the domain list changed", () => {
    expect(
      shouldRenew(meta(60), ["example.com", "www.example.com"], 30, now),
    ).toBe(true);
  });

  test("ignores the order of the domain list", () => {
    expect(
      shouldRenew(
        meta(60, ["www.example.com", "example.com"]),
        ["example.com", "www.example.com"],
        30,
        now,
      ),
    ).toBe(false);
  });

  test("renews when the stored date is unreadable", () => {
    expect(
      shouldRenew(
        { domains: ["example.com"], notAfter: "soon", issuedAt: "" },
        ["example.com"],
        30,
        now,
      ),
    ).toBe(true);
  });
});
