import cluster from "node:cluster";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

import { challengeResponse, clearChallenge, setChallenge } from "./acme.ts";
import type { Trust } from "./adapter.ts";
import { sendResponse, toRequest, trustPredicate } from "./adapter.ts";
import type { ResolvedServe, ServeOverrides } from "./config.ts";
import { resolveServe } from "./config.ts";
import { nativeTarget, skewResponse, withoutFlypathHeaders } from "./skew.ts";
import { serveStatic } from "./static.ts";
import { after } from "./timers.ts";
import type { Material } from "./tls.ts";
import { readMaterial, redirectResponse, secureContext } from "./tls.ts";

export type Handler = (request: Request) => Promise<Response>;

export const HEALTH_PATH = "/_flypath/health";

type ChallengeMessage = {
  type: "acme-challenge";
  token: string;
  authorization: string | null;
};

type TlsMessage = { type: "tls-reload" };

type StopMessage = { type: "stop" };

export type ServeMessage = ChallengeMessage | TlsMessage | StopMessage;

async function loadHandler(root: string): Promise<Handler> {
  const entry = path.join(root, "dist", "rsc", "index.js");
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  } catch (error) {
    throw new Error(
      `flypath: could not load ${entry}; run flypath build first`,
      { cause: error },
    );
  }
  const handler = module.default;
  if (typeof handler !== "function") {
    throw new TypeError(
      `flypath: ${entry} has no default export to serve; run flypath build`,
    );
  }
  return handler as Handler;
}

const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml|xhtml\+xml)|image\/svg\+xml)/;

const COMPRESS_THRESHOLD = 1024;

function negotiate(request: Request): "br" | "gzip" | undefined {
  const header = request.headers.get("accept-encoding")?.toLowerCase() ?? "";
  if (header.includes("br")) return "br";
  if (header.includes("gzip")) return "gzip";
  return undefined;
}

function compress(response: Response, encoding: "br" | "gzip"): Response {
  if (response.headers.has("content-encoding")) return response;
  if (!response.body) return response;
  const type = response.headers.get("content-type") ?? "";
  if (!COMPRESSIBLE.test(type)) return response;
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) < COMPRESS_THRESHOLD) return response;

  const transform =
    encoding === "br"
      ? zlib.createBrotliCompress({
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        })
      : zlib.createGzip({ level: 6 });

  const source = Readable.fromWeb(
    response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  const piped = source.pipe(transform);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-encoding", encoding);
  const vary = headers.get("vary");
  headers.set(
    "vary",
    vary === null || vary === ""
      ? "Accept-Encoding"
      : vary.toLowerCase().includes("accept-encoding")
        ? vary
        : `${vary}, Accept-Encoding`,
  );

  return new Response(Readable.toWeb(piped) as unknown as ReadableStream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

type Drain = {
  draining: boolean;
  inflight: number;
  idle: (() => void) | undefined;
};

function track(state: Drain): () => void {
  state.inflight += 1;
  return () => {
    state.inflight -= 1;
    if (state.inflight === 0 && state.draining) state.idle?.();
  };
}

function healthResponse(state: Drain): Response {
  return new Response(state.draining ? "draining" : "ok", {
    status: state.draining ? 503 : 200,
    headers: {
      "content-type": "text/plain;charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function logAccess(
  serve: ResolvedServe,
  request: Request,
  status: number,
  started: number,
  address: string | undefined,
): void {
  if (serve.accessLog === false) return;
  const ms = Math.round(performance.now() - started);
  const url = new URL(request.url);
  if (serve.accessLog === "combined") {
    console.log(
      `${address ?? "-"} "${request.method} ${url.pathname}${url.search} HTTP/1.1" ` +
        `${String(status)} ${String(ms)}ms "${request.headers.get("referer") ?? "-"}" ` +
        `"${request.headers.get("user-agent") ?? "-"}"`,
    );
    return;
  }
  console.log(
    `${request.method} ${url.pathname}${url.search} ${String(status)} ${String(ms)}ms`,
  );
}

function errorResponse(error: unknown): Response {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  return new Response("Internal Server Error", {
    status: 500,
    headers: { "content-type": "text/plain;charset=utf-8" },
  });
}

type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function requestListener(options: {
  serve: ResolvedServe;
  state: Drain;
  trust: Trust;
  secure: boolean;
  respond: (request: Request) => Promise<Response> | Response;
}): Listener {
  const { serve, state, trust, secure, respond } = options;

  return (req, res) => {
    const started = performance.now();
    const done = track(state);
    const { request, peer } = toRequest(req, {
      secure,
      trustProxy: serve.trustProxy,
      trust,
    });

    void (async () => {
      let response: Response;
      try {
        response = await respond(request);
      } catch (error) {
        response = request.signal.aborted
          ? new Response(null, { status: 499 })
          : errorResponse(error);
      }

      if (state.draining) {
        const headers = new Headers(response.headers);
        headers.set("connection", "close");
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      logAccess(serve, request, response.status, started, peer.address);

      try {
        await sendResponse(res, response, req.method === "HEAD");
      } catch {
        if (!res.writableEnded) res.destroy();
      } finally {
        done();
      }
    })();
  };
}

function application(options: {
  serve: ResolvedServe;
  state: Drain;
  handler: Handler;
}): (request: Request) => Promise<Response> {
  const { serve, state, handler } = options;

  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) return healthResponse(state);

    const challenge = challengeResponse(url.pathname);
    if (challenge) return challenge;

    const skewed = skewResponse(request, {
      clientDir: serve.static?.dir,
      minimumBuild: serve.minimumBuild,
    });
    if (skewed) return skewed;

    if (serve.static) {
      const native = nativeTarget(url.pathname) !== undefined;
      const file = serveStatic(
        native ? withoutFlypathHeaders(request) : request,
        serve.static,
      );
      if (file) return file;
    }

    const response = await handler(request);
    if (!serve.compress) return response;
    const encoding = negotiate(request);
    return encoding === undefined ? response : compress(response, encoding);
  };
}

function plainRedirect(options: {
  serve: ResolvedServe;
  state: Drain;
  port: number;
}): (request: Request) => Response {
  const { serve, state, port } = options;
  return (request) => {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) return healthResponse(state);
    const challenge = challengeResponse(url.pathname);
    if (challenge) return challenge;
    if (!serve.tls?.redirect) return new Response("Not Found", { status: 404 });
    return redirectResponse(request, port);
  };
}

function listen(
  server: http.Server | https.Server,
  port: number,
  host: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    server.once("error", failed);
    server.listen(port, host, () => {
      server.off("error", failed);
      const address = server.address() as AddressInfo | null;
      resolve(address?.port ?? port);
    });
  });
}

function close(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export type Serving = {
  port: number;
  tlsPort: number | undefined;
  stop: () => Promise<void>;
};

export async function serveProcess(
  serve: ResolvedServe,
  provided?: Handler,
): Promise<Serving> {
  const handler = provided ?? (await loadHandler(serve.root));
  const trust = trustPredicate(serve.trustProxy);
  const state: Drain = { draining: false, inflight: 0, idle: undefined };

  const respond = application({ serve, state, handler });

  const servers: (http.Server | https.Server)[] = [];
  let tlsPort: number | undefined;
  let port = serve.port;

  if (serve.tls) {
    const plain = http.createServer(
      requestListener({
        serve,
        state,
        trust,
        secure: false,
        respond: plainRedirect({ serve, state, port: serve.tls.port }),
      }),
    );
    servers.push(plain);
    port = await listen(plain, serve.port, serve.host);
    console.log(
      `flypath: listening on http://${display(serve.host)}:${String(port)} (ACME + redirect)`,
    );

    const material = await ensureMaterial(serve);
    const secure = https.createServer(
      secureContext(material),
      requestListener({ serve, state, trust, secure: true, respond }),
    );
    servers.push(secure);
    tlsPort = await listen(secure, serve.tls.port, serve.host);
    console.log(
      `flypath: listening on https://${display(serve.host)}:${String(tlsPort)}`,
    );

    const reload = (): void => {
      const next = readMaterial(serve.tls as NonNullable<typeof serve.tls>);
      if (!next) return;
      secure.setSecureContext(secureContext(next));
      console.log("flypath: reloaded the TLS certificate");
    };
    process.on("SIGHUP", reload);
    process.on("message", (message: ServeMessage) => {
      if (message.type === "tls-reload") reload();
      if (message.type === "acme-challenge") {
        if (message.authorization === null) clearChallenge(message.token);
        else setChallenge(message.token, message.authorization);
      }
    });
  } else {
    const plain = http.createServer(
      requestListener({ serve, state, trust, secure: false, respond }),
    );
    servers.push(plain);
    port = await listen(plain, serve.port, serve.host);
    console.log(
      `flypath: listening on http://${display(serve.host)}:${String(port)}`,
    );
  }

  const stop = async (): Promise<void> => {
    if (state.draining) return;
    state.draining = true;
    const idle =
      state.inflight === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            state.idle = resolve;
          });
    if (serve.drainDelay > 0) {
      await new Promise<void>((resolve) => {
        after(serve.drainDelay * 1000, resolve).unref();
      });
    }
    const closed = Promise.all(servers.map((server) => close(server)));
    await Promise.race([
      Promise.all([closed, idle]),
      new Promise<void>((resolve) => {
        after(serve.shutdownTimeout * 1000, resolve).unref();
      }),
    ]);
    for (const server of servers) server.closeAllConnections();
  };

  return { port, tlsPort, stop };
}

function display(host: string): string {
  if (host === "::" || host === "0.0.0.0") return "localhost";
  return host.includes(":") ? `[${host}]` : host;
}

async function ensureMaterial(serve: ResolvedServe): Promise<Material> {
  const tls = serve.tls;
  if (!tls) throw new Error("flypath: serve.tls is not configured");
  const held = readMaterial(tls);
  if (held) return held;
  if (!tls.acme) {
    throw new Error(
      "flypath: serve.tls.key and serve.tls.cert do not exist yet, and no " +
        "acme block is configured to obtain one",
    );
  }
  const { obtain } = await import("./acme.ts");
  await obtain(tls.acme);
  const material = readMaterial(tls);
  if (!material) {
    throw new Error("flypath: the certificate was not written to storage");
  }
  return material;
}

function untilSignal(stop: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      console.log("flypath: draining");
      void stop().then(resolve, resolve);
    };
    process.on("SIGINT", done);
    process.on("SIGTERM", done);
    process.on("message", (message: ServeMessage) => {
      if (message.type === "stop") done();
    });
  });
}

export async function start(overrides: ServeOverrides = {}): Promise<void> {
  const root = process.cwd();
  const { loadEnv } = await import("../db/config.ts");
  loadEnv(root);
  const { loadOptions } = await import("../native/config.ts");
  const options = await loadOptions(root);
  const serve = resolveServe(root, options, overrides);

  if (cluster.isPrimary && serve.workers > 0) {
    const { primary } = await import("./cluster.ts");
    await primary(serve);
    return;
  }

  const serving = await serveProcess(serve);
  await untilSignal(serving.stop);
  const { closePools } = await import("../db/client.ts");
  await closePools();
  if (cluster.isWorker) process.disconnect();
}
