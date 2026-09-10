import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createCsr } from "../../src/serve/acme.ts";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-csr-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function openssl(der: Uint8Array, name: string): string {
  const file = path.join(dir, `${name}.der`);
  fs.writeFileSync(file, der);
  return execFileSync(
    "openssl",
    ["req", "-inform", "DER", "-in", file, "-verify", "-noout", "-text"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("createCsr", () => {
  test("openssl verifies a single-domain request", async () => {
    const { der } = await createCsr(["example.com"]);
    const text = openssl(der, "single");
    expect(text).toContain("DNS:example.com");
    expect(text).toContain("id-ecPublicKey");
  });

  test("openssl verifies a request carrying every domain as a SAN", async () => {
    const { der } = await createCsr([
      "example.com",
      "www.example.com",
      "api.example.com",
    ]);
    const text = openssl(der, "sans");
    expect(text).toContain("DNS:example.com");
    expect(text).toContain("DNS:www.example.com");
    expect(text).toContain("DNS:api.example.com");
  });

  test("signs with ECDSA over SHA-256 and an empty subject", async () => {
    const { der } = await createCsr(["example.com"]);
    const text = openssl(der, "alg");
    expect(text).toMatch(/Signature Algorithm: ecdsa-with-SHA256/);
    expect(text).toMatch(/Subject:\s*$/m);
  });

  test("hands back a PKCS#8 key for the certificate", async () => {
    const { pem } = await createCsr(["example.com"]);
    expect(pem.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(pem.trimEnd().endsWith("-----END PRIVATE KEY-----")).toBe(true);
  });
});
