import cluster from "node:cluster";
import type { Worker } from "node:cluster";
import http from "node:http";

import { acquire, challengeResponse, readMeta, shouldRenew } from "./acme.ts";
import type { ResolvedServe } from "./config.ts";
import type { ServeMessage } from "./index.ts";
import { after, cancel, every } from "./timers.ts";

const RESTART_WINDOW = 10_000;

const RESTART_LIMIT = 5;

const BACKOFF_CAP = 30_000;

const RENEW_INTERVAL = 60 * 60 * 1000;

export function backoff(attempt: number): number {
  return Math.min(BACKOFF_CAP, 250 * 2 ** attempt);
}

export type RestartState = { failures: number[]; attempt: number };

export type Restart = { bail: boolean; delay: number };

export function newRestartState(): RestartState {
  return { failures: [], attempt: 0 };
}

export function recordExit(
  state: RestartState,
  code: number | null,
  at: number,
): Restart {
  if (code === 0) {
    state.attempt = 0;
    return { bail: false, delay: 0 };
  }

  state.failures.push(at);
  while (
    state.failures.length > 0 &&
    at - (state.failures[0] ?? 0) > RESTART_WINDOW
  ) {
    state.failures.shift();
  }
  if (state.failures.length >= RESTART_LIMIT) {
    return { bail: true, delay: 0 };
  }

  state.attempt += 1;
  return { bail: false, delay: backoff(state.attempt) };
}

function broadcast(message: ServeMessage): void {
  for (const worker of Object.values(cluster.workers ?? {})) {
    if (worker?.isConnected()) worker.send(message);
  }
}

async function challengeListener(
  serve: ResolvedServe,
): Promise<{ close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const response = challengeResponse(
      new URL(req.url ?? "/", "http://x").pathname,
    );
    if (!response) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }
    void response.text().then((body) => {
      res.writeHead(response.status, {
        "content-type": "application/octet-stream",
      });
      res.end(body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(serve.port, serve.host, () => resolve());
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function issue(serve: ResolvedServe, standalone: boolean): Promise<void> {
  const acme = serve.tls?.acme;
  if (!acme) return;

  const primary = acme.domains[0];
  if (primary === undefined) return;
  if (
    !shouldRenew(
      readMeta(acme.storage, primary),
      acme.domains,
      acme.renewBefore,
    )
  ) {
    return;
  }

  const lock = acquire(acme.storage);
  if (!lock) {
    console.warn(
      "flypath: another process holds the ACME lock; skipping this attempt",
    );
    return;
  }

  const listener = standalone ? await challengeListener(serve) : undefined;
  try {
    const { obtain } = await import("./acme.ts");
    await obtain({
      ...acme,
      publish: (token, authorization) => {
        broadcast({ type: "acme-challenge", token, authorization });
      },
    });
    broadcast({ type: "tls-reload" });
  } finally {
    await listener?.close();
    lock.release();
  }
}

export async function primary(serve: ResolvedServe): Promise<void> {
  if (serve.tls?.acme) {
    const domain = serve.tls.acme.domains[0];
    const meta =
      domain === undefined
        ? undefined
        : readMeta(serve.tls.acme.storage, domain);
    if (
      domain !== undefined &&
      shouldRenew(meta, serve.tls.acme.domains, serve.tls.acme.renewBefore)
    ) {
      console.log("flypath: no usable certificate on disk — obtaining one");
      await issue(serve, true);
    }
  }

  const restarts = newRestartState();
  let stopping = false;

  const fork = (): Worker => {
    const worker = cluster.fork();
    worker.on("message", (message: ServeMessage) => {
      if (message.type === "acme-challenge" || message.type === "tls-reload") {
        broadcast(message);
      }
    });
    return worker;
  };

  cluster.on("exit", (worker, code, signal) => {
    if (stopping) return;

    const { bail, delay } = recordExit(restarts, code, Date.now());
    if (bail) {
      console.error(
        `flypath: ${String(RESTART_LIMIT)} workers failed within ` +
          `${String(RESTART_WINDOW / 1000)}s — refusing to restart-loop`,
      );
      stopping = true;
      for (const entry of Object.values(cluster.workers ?? {})) entry?.kill();
      process.exit(code ?? 1);
    }

    console.warn(
      `flypath: worker ${String(worker.process.pid)} exited ` +
        `(${signal ?? String(code)}); restarting in ${String(delay)}ms`,
    );
    after(delay, () => void fork()).unref();
  });

  for (let at = 0; at < serve.workers; at += 1) fork();
  console.log(`flypath: ${String(serve.workers)} workers`);

  const renewal = every(RENEW_INTERVAL, () => {
    void issue(serve, false).catch((error: unknown) => {
      console.warn(
        `flypath: certificate renewal failed — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  });
  renewal.unref();

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      cancel(renewal);
      console.log("flypath: draining workers");
      broadcast({ type: "stop" });

      const timer = after((serve.shutdownTimeout + 5) * 1000, () => {
        for (const worker of Object.values(cluster.workers ?? {}))
          worker?.kill();
        resolve();
      });
      timer.unref();

      const check = (): void => {
        if (Object.keys(cluster.workers ?? {}).length > 0) return;
        cancel(timer);
        resolve();
      };
      cluster.on("exit", check);
      check();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
