import { afterEach, expect, test, vi } from "vitest";

import { context, createContextStore } from "../../src/router/context.ts";
import { runMiddleware } from "../../src/router/middleware.ts";
import { navigate } from "../../src/router/navigate-server.ts";
import { NavigationError } from "../../src/router/navigation.ts";
import { cookies } from "../../src/runtime/cookies.ts";
import { runWithRequest } from "../../src/runtime/platform-store.ts";
import { headers } from "../../src/runtime/platform.ts";
import type { RequestInfo } from "../../src/runtime/platform.ts";
import { prerenderPages } from "../../src/runtime/prerender.ts";

function request(phase: RequestInfo["phase"]): RequestInfo {
  return {
    phase,
    platform: "web",
    pathname: "/",
    params: {},
    search: {},
    headers: new Headers(),
    outgoing: new Headers(),
    prefetch: false,
    prerender: false,
    context: createContextStore(),
  };
}

afterEach(() => vi.useRealTimers());

test("rendering rejects response changes and context writes after suspension", async () => {
  const value = context("initial");
  await runWithRequest(request("render"), async () => {
    await Promise.resolve();
    expect(() => navigate("/other")).toThrow(/response is streaming/);
    expect(() => navigate("not-found")).toThrow(/response is streaming/);
    expect(() => headers.set("x-test", "value")).toThrow(
      /response is streaming/,
    );
    expect(() => headers.delete("x-test")).toThrow(/response is streaming/);
    expect(() => cookies.set("session", "value")).toThrow(
      /response is streaming/,
    );
    expect(() => cookies.clear("session")).toThrow(/response is streaming/);
    expect(() => value.set("changed")).toThrow(/outside a middleware/);
    expect(value()).toBe("initial");
  });
});

test.each(["middleware", "action"] as const)(
  "%s can still decide the response",
  (phase) => {
    const info = request(phase);
    runWithRequest(info, () => {
      headers.set("x-test", "value");
      cookies.set("session", "value");
      expect(() => navigate("/other")).toThrow(NavigationError);
      expect(() => navigate("not-found")).toThrow(NavigationError);
    });
    expect(info.outgoing.get("x-test")).toBe("value");
    expect(info.outgoing.getSetCookie()).toEqual(["session=value; Path=/"]);
  },
);

test("middleware cancels a render when replacing its response", async () => {
  const cancelled = Promise.withResolvers<void>();
  const response = await runMiddleware(
    [
      async (next) => {
        await next();
        return new Response("replacement");
      },
    ],
    async () =>
      new Response(new ReadableStream({ cancel: () => cancelled.resolve() })),
    async () => new Response("redirect"),
  );
  expect(await response.text()).toBe("replacement");
  await cancelled.promise;
});

test("middleware cancels a render when redirecting after next", async () => {
  const cancelled = Promise.withResolvers<void>();
  const response = await runMiddleware(
    [
      async (next) => {
        await next();
        throw new NavigationError({
          kind: "go",
          to: "/other",
          mode: "replace",
          permanent: false,
        });
      },
    ],
    async () =>
      new Response(new ReadableStream({ cancel: () => cancelled.resolve() })),
    async () =>
      new Response(null, { status: 307, headers: { location: "/other" } }),
  );
  expect(response.status).toBe(307);
  await cancelled.promise;
});

test("prerender times out and cancels a stalled response body", async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn<() => void>();
  let signal: AbortSignal | undefined;
  const pending = prerenderPages(
    async (request) => {
      signal = request.signal;
      return new Response(new ReadableStream({ cancel: cancelled }));
    },
    ["/slow"],
  );
  const failed = pending.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(failed).resolves.toMatchObject({
    message: expect.stringContaining("did not finish within 30s"),
  });
  expect(signal?.aborted).toBe(true);
  expect(cancelled).toHaveBeenCalledOnce();
});

test("prerender still collects complete HTML and Flight files", async () => {
  const pages = await prerenderPages(
    async (request) => new Response(new URL(request.url).pathname),
    ["/about"],
  );
  expect(pages[0]?.document).toBe("/about");
  expect(new TextDecoder().decode(pages[0]?.flight)).toBe("/about.flight");
});
