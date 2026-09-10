import fs from "node:fs";
import path from "node:path";
import type { SecureContextOptions } from "node:tls";

import type { ResolvedTls } from "./config.ts";

export type Material = {
  key: string;
  cert: string;
  ca: string | undefined;
};

type MaterialPaths = {
  key: string;
  cert: string;
  ca: string | undefined;
};

function materialPaths(tls: ResolvedTls): MaterialPaths | undefined {
  if (tls.key !== undefined && tls.cert !== undefined) {
    return { key: tls.key, cert: tls.cert, ca: tls.ca };
  }
  if (!tls.acme) return undefined;
  const primary = tls.acme.domains[0];
  if (primary === undefined) return undefined;
  const dir = path.join(tls.acme.storage, primary);
  return {
    key: path.join(dir, "privkey.pem"),
    cert: path.join(dir, "fullchain.pem"),
    ca: tls.ca,
  };
}

export function readMaterial(tls: ResolvedTls): Material | undefined {
  const paths = materialPaths(tls);
  if (!paths) return undefined;
  if (!fs.existsSync(paths.key) || !fs.existsSync(paths.cert)) return undefined;
  return {
    key: fs.readFileSync(paths.key, "utf8"),
    cert: fs.readFileSync(paths.cert, "utf8"),
    ca:
      paths.ca !== undefined && fs.existsSync(paths.ca)
        ? fs.readFileSync(paths.ca, "utf8")
        : undefined,
  };
}

export function secureContext(material: Material): SecureContextOptions {
  return {
    key: material.key,
    cert: material.cert,
    ...(material.ca === undefined ? {} : { ca: material.ca }),
    minVersion: "TLSv1.2",
    honorCipherOrder: true,
  };
}

export function redirectResponse(request: Request, port: number): Response {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.port = port === 443 ? "" : String(port);
  return new Response(null, {
    status: 308,
    headers: { location: url.href, "cache-control": "no-store" },
  });
}
