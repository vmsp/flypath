import os from "node:os";
import path from "node:path";

import * as env from "../shared/env.ts";

type AcmeOptions = {
  email: string;
  domains: string[];
  agree: true;
  directory?: "production" | "staging" | string;
  storage?: string;
  renewBefore?: number;
};

type TlsOptions = {
  key?: string;
  cert?: string;
  ca?: string;
  port?: number;
  redirect?: boolean;
  acme?: AcmeOptions;
};

type StaticOptions = {
  dir?: string;
  compress?: boolean;
};

export type ServeOptions = {
  port?: number;
  host?: string;
  cluster?: boolean | number;
  static?: false | StaticOptions;
  compress?: boolean;
  trustProxy?: boolean | number | string[];
  drainDelay?: number;
  shutdownTimeout?: number;
  minimumBuild?: string;
  accessLog?: boolean | "combined" | "short";
  tls?: TlsOptions;
};

export type ResolvedAcme = {
  email: string;
  domains: string[];
  directory: string;
  storage: string;
  renewBefore: number;
};

export type ResolvedTls = {
  key: string | undefined;
  cert: string | undefined;
  ca: string | undefined;
  port: number;
  redirect: boolean;
  acme: ResolvedAcme | undefined;
};

type ResolvedStatic = {
  dir: string;
  compress: boolean;
};

export type ResolvedServe = {
  root: string;
  url: string | undefined;
  port: number;
  host: string;
  workers: number;
  static: ResolvedStatic | undefined;
  compress: boolean;
  trustProxy: boolean | number | string[];
  drainDelay: number;
  shutdownTimeout: number;
  minimumBuild: string | undefined;
  accessLog: false | "combined" | "short";
  tls: ResolvedTls | undefined;
};

export type ServeOverrides = {
  port?: number | undefined;
  host?: string | undefined;
  cluster?: string | undefined;
};

const DEFAULT_PORT = 3000;

const DEFAULT_TLS_PORT = 443;

const DEFAULT_SHUTDOWN = 25;

const DEFAULT_DRAIN_DELAY = 5;

const DEFAULT_RENEW_BEFORE = 30;

const DIRECTORIES: Record<string, string> = {
  production: "https://acme-v02.api.letsencrypt.org/directory",
  staging: "https://acme-staging-v02.api.letsencrypt.org/directory",
};

function integer(value: string | undefined, key: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `flypath: ${key} must be a non-negative number, got ${value}`,
    );
  }
  return Math.floor(parsed);
}

function workerCount(
  setting: boolean | number | undefined,
  override: string | undefined,
): number {
  const raw = override ?? env.cluster();

  if (raw !== undefined && raw.trim() !== "") {
    const text = raw.trim().toLowerCase();
    if (text === "off" || text === "false" || text === "no") return 0;
    if (text === "on" || text === "true" || text === "auto") {
      return os.availableParallelism();
    }
    const parsed = integer(text, "--cluster");
    return parsed === undefined || parsed <= 1 ? 0 : parsed;
  }

  if (setting === undefined || setting === true)
    return os.availableParallelism();
  if (setting === false) return 0;
  return setting <= 1 ? 0 : Math.floor(setting);
}

function acme(
  root: string,
  options: AcmeOptions | undefined,
): ResolvedAcme | undefined {
  if (!options) return undefined;
  if (options.agree !== true) {
    throw new Error(
      "flypath: serve.tls.acme needs agree: true — obtaining a certificate " +
        "accepts the CA's terms of service on your behalf",
    );
  }
  if (!options.email) {
    throw new Error("flypath: serve.tls.acme.email is required");
  }
  if (!options.domains || options.domains.length === 0) {
    throw new Error("flypath: serve.tls.acme.domains must name a domain");
  }

  const directory = options.directory ?? "production";
  return {
    email: options.email,
    domains: [...options.domains],
    directory: DIRECTORIES[directory] ?? directory,
    storage: path.resolve(root, options.storage ?? ".flypath/certs"),
    renewBefore: options.renewBefore ?? DEFAULT_RENEW_BEFORE,
  };
}

function tls(
  root: string,
  options: TlsOptions | undefined,
): ResolvedTls | undefined {
  if (!options) return undefined;
  const resolved = acme(root, options.acme);
  if (!resolved && !(options.key && options.cert)) {
    throw new Error(
      "flypath: serve.tls needs either key and cert, or an acme block",
    );
  }
  return {
    key:
      options.key === undefined ? undefined : path.resolve(root, options.key),
    cert:
      options.cert === undefined ? undefined : path.resolve(root, options.cert),
    ca: options.ca === undefined ? undefined : path.resolve(root, options.ca),
    port: env.tlsPort() ?? options.port ?? DEFAULT_TLS_PORT,
    redirect: options.redirect ?? true,
    acme: resolved,
  };
}

function statics(
  root: string,
  options: false | StaticOptions | undefined,
): ResolvedStatic | undefined {
  if (options === false) return undefined;
  return {
    dir: path.resolve(root, options?.dir ?? "dist/client"),
    compress: options?.compress ?? true,
  };
}

function publicUrl(url: string | undefined): string | undefined {
  const declared = url?.trim().replace(/\/+$/, "");
  return env.appUrl() ?? (declared === "" ? undefined : declared);
}

export function resolveServe(
  root: string,
  options: { url?: string | undefined; serve?: ServeOptions | undefined },
  overrides: ServeOverrides = {},
): ResolvedServe {
  const serve = options.serve ?? {};
  const trustProxy = serve.trustProxy ?? false;
  const log = serve.accessLog ?? true;
  const plain = serve.tls ? 80 : DEFAULT_PORT;

  return {
    root,
    url: publicUrl(options.url),
    port: overrides.port ?? env.port() ?? serve.port ?? plain,
    host: overrides.host ?? env.host() ?? serve.host ?? "::",
    workers: workerCount(serve.cluster, overrides.cluster),
    static: statics(root, serve.static),
    compress: serve.compress ?? trustProxy === false,
    trustProxy,
    drainDelay: serve.drainDelay ?? DEFAULT_DRAIN_DELAY,
    shutdownTimeout: serve.shutdownTimeout ?? DEFAULT_SHUTDOWN,
    minimumBuild: serve.minimumBuild,
    accessLog: log === true ? "short" : log,
    tls: tls(root, serve.tls),
  };
}
