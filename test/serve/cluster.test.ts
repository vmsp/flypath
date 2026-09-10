import http from "node:http";
import os from "node:os";

import { afterEach, describe, expect, test } from "vitest";

import {
  backoff,
  newRestartState,
  recordExit,
} from "../../src/serve/cluster.ts";
import { resolveServe } from "../../src/serve/config.ts";
import { HEALTH_PATH, serveProcess } from "../../src/serve/index.ts";

const ENV = ["FLYPATH_CLUSTER", "WEB_CONCURRENCY", "PORT", "HOST"] as const;

afterEach(() => {
  for (const key of ENV) delete process.env[key];
});

describe("fork count", () => {
  test("true means every core", () => {
    expect(resolveServe("/tmp", { serve: { cluster: true } }).workers).toBe(
      os.availableParallelism(),
    );
  });

  test("the default is every core", () => {
    expect(resolveServe("/tmp", {}).workers).toBe(os.availableParallelism());
  });

  test("false and 1 mean a single process with no primary", () => {
    expect(resolveServe("/tmp", { serve: { cluster: false } }).workers).toBe(0);
    expect(resolveServe("/tmp", { serve: { cluster: 1 } }).workers).toBe(0);
  });

  test("a number is taken as is", () => {
    expect(resolveServe("/tmp", { serve: { cluster: 8 } }).workers).toBe(8);
  });

  test("the environment overrides the config", () => {
    process.env["WEB_CONCURRENCY"] = "3";
    expect(resolveServe("/tmp", { serve: { cluster: 8 } }).workers).toBe(3);
    process.env["FLYPATH_CLUSTER"] = "off";
    expect(resolveServe("/tmp", { serve: { cluster: 8 } }).workers).toBe(0);
  });

  test("the flag overrides the environment", () => {
    process.env["FLYPATH_CLUSTER"] = "8";
    expect(
      resolveServe("/tmp", { serve: { cluster: true } }, { cluster: "2" })
        .workers,
    ).toBe(2);
  });
});

describe("restart backoff", () => {
  test("grows exponentially and caps at 30s", () => {
    expect(backoff(1)).toBe(500);
    expect(backoff(2)).toBe(1000);
    expect(backoff(3)).toBe(2000);
    expect(backoff(20)).toBe(30_000);
  });

  test("a clean exit restarts immediately and forgets the attempt", () => {
    const state = newRestartState();
    recordExit(state, 1, 0);
    recordExit(state, 1, 1);
    expect(recordExit(state, 0, 2)).toEqual({ bail: false, delay: 0 });
    expect(recordExit(state, 1, 3).delay).toBe(backoff(1));
  });

  test("backs off further on each consecutive failure", () => {
    const state = newRestartState();
    expect(recordExit(state, 1, 0).delay).toBe(500);
    expect(recordExit(state, 1, 20_000).delay).toBe(1000);
  });
});

describe("the restart-loop bail-out", () => {
  test("bails after five failures inside the window", () => {
    const state = newRestartState();
    for (let at = 0; at < 4; at += 1) {
      expect(recordExit(state, 1, at * 100).bail).toBe(false);
    }
    expect(recordExit(state, 1, 500).bail).toBe(true);
  });

  test("keeps restarting when the failures are spread out", () => {
    const state = newRestartState();
    for (let at = 0; at < 10; at += 1) {
      expect(recordExit(state, 1, at * 11_000).bail).toBe(false);
    }
  });
});

function ping(port: number, agent: http.Agent): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: HEALTH_PATH, agent },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function slowHandler(held: Promise<void>) {
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== "/slow") return new Response("ok");
    await held;
    return new Response("late");
  };
}

describe("drain", () => {
  test("flips health to 503, finishes in flight work, then stops", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const serve = resolveServe(
      process.cwd(),
      {
        serve: {
          static: false,
          cluster: false,
          accessLog: false,
          drainDelay: 0.3,
          shutdownTimeout: 5,
        },
      },
      { port: 0, host: "127.0.0.1" },
    );

    const serving = await serveProcess(serve, slowHandler(held));

    const origin = `http://127.0.0.1:${String(serving.port)}`;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    expect(await ping(serving.port, agent)).toBe(200);

    const slow = fetch(`${origin}/slow`);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    const stopping = serving.stop();
    expect(await ping(serving.port, agent)).toBe(503);
    agent.destroy();

    release?.();
    const finished = await slow;
    expect(finished.status).toBe(200);
    expect(await finished.text()).toBe("late");
    expect(finished.headers.get("connection")).toBe("close");

    await stopping;

    await expect(fetch(`${origin}/`)).rejects.toThrow("fetch failed");
  });
});
