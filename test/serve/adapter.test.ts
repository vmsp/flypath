import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  resolvePeer,
  sendResponse,
  toRequest,
  trustPredicate,
} from "../../src/serve/adapter.ts";

type Handler = (request: Request) => Promise<Response> | Response;

let respond: Handler = () => new Response("ok");

let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void (async () => {
      const { request } = toRequest(req, {
        secure: false,
        trustProxy: ["127.0.0.1/32", "::1/128", "::ffff:127.0.0.1/128"],
      });
      try {
        await sendResponse(res, await respond(request), req.method === "HEAD");
      } catch {
        if (!res.writableEnded) res.destroy();
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

describe("toRequest", () => {
  test("carries the method and builds an absolute url from the socket", async () => {
    let seen = "";
    let method = "";
    respond = (request) => {
      seen = request.url;
      method = request.method;
      return new Response("ok");
    };
    await fetch(`${origin}/a/b?c=1`, { method: "DELETE" });
    expect(method).toBe("DELETE");
    expect(new URL(seen).pathname).toBe("/a/b");
    expect(new URL(seen).search).toBe("?c=1");
    expect(new URL(seen).protocol).toBe("http:");
  });

  test("honours forwarded headers from a trusted peer", async () => {
    let seen = "";
    respond = (request) => {
      seen = request.url;
      return new Response("ok");
    };
    await fetch(`${origin}/x`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "example.com",
      },
    });
    expect(seen).toBe("https://example.com/x");
  });

  test("round trips a multipart body through Request.formData()", async () => {
    let name: string | undefined;
    respond = async (request) => {
      const form = (await request.formData()) as unknown as Map<string, string>;
      name = form.get("user");
      return new Response("ok");
    };
    const body = new FormData();
    body.set("user", "ada");
    await fetch(`${origin}/login`, { method: "POST", body });
    expect(name).toBe("ada");
  });

  test("round trips a text body", async () => {
    let body = "";
    respond = async (request) => {
      body = await request.text();
      return new Response("ok");
    };
    await fetch(`${origin}/action`, { method: "POST", body: "[1,2]" });
    expect(body).toBe("[1,2]");
  });

  test("keeps a GET body-less", async () => {
    let hasBody = true;
    respond = (request) => {
      hasBody = request.body !== null;
      return new Response("ok");
    };
    await fetch(`${origin}/`);
    expect(hasBody).toBe(false);
  });
});

describe("sendResponse", () => {
  test("appends every set-cookie rather than joining them", async () => {
    respond = () => {
      const headers = new Headers();
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response("ok", { headers });
    };
    const response = await fetch(`${origin}/`);
    expect(response.headers.getSetCookie()).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  test("sends headers and no body for HEAD", async () => {
    respond = () => new Response("hello", { headers: { "x-t": "1" } });
    const response = await fetch(`${origin}/`, { method: "HEAD" });
    expect(response.headers.get("x-t")).toBe("1");
    expect(await response.text()).toBe("");
  });

  test("carries the status through", async () => {
    respond = () => new Response("nope", { status: 418 });
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(418);
  });
});

describe("abort", () => {
  test("a client that hangs up aborts the request signal", async () => {
    let seen = false;
    let notice: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      notice = resolve;
    });

    respond = (request) => {
      request.signal.addEventListener("abort", () => {
        seen = true;
        notice?.();
      });
      return new Promise<Response>(() => {
        // the client hangs up before this ever resolves
      });
    };

    const controller = new AbortController();
    const pending = fetch(`${origin}/slow`, { signal: controller.signal });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    controller.abort();
    await pending.catch(() => undefined);
    await aborted;
    expect(seen).toBe(true);
  });
});

describe("trustPredicate", () => {
  test("false trusts nobody", () => {
    const trust = trustPredicate(false);
    expect(trust("127.0.0.1")).toBe(false);
    expect(trust("10.0.0.1")).toBe(false);
  });

  test("true trusts anybody", () => {
    const trust = trustPredicate(true);
    expect(trust("8.8.8.8")).toBe(true);
  });

  test("matches ipv4 cidrs", () => {
    const trust = trustPredicate(["10.0.0.0/8", "192.168.1.5"]);
    expect(trust("10.255.3.4")).toBe(true);
    expect(trust("11.0.0.1")).toBe(false);
    expect(trust("192.168.1.5")).toBe(true);
    expect(trust("192.168.1.6")).toBe(false);
  });

  test("matches ipv6 and v4-mapped addresses", () => {
    const trust = trustPredicate(["::1/128", "10.0.0.0/8"]);
    expect(trust("::1")).toBe(true);
    expect(trust("::2")).toBe(false);
    expect(trust("::ffff:10.1.2.3")).toBe(true);
    expect(trust("fd00::1")).toBe(false);
  });
});

function incoming(headers: Record<string, string>, remote: string) {
  const raw: string[] = [];
  for (const [key, value] of Object.entries(headers)) raw.push(key, value);
  return {
    headers,
    rawHeaders: raw,
    socket: { remoteAddress: remote },
  } as unknown as http.IncomingMessage;
}

describe("resolvePeer", () => {
  test("ignores forwarded headers from an untrusted peer", () => {
    const peer = resolvePeer(
      incoming(
        { "x-forwarded-proto": "https", "x-forwarded-for": "1.2.3.4" },
        "8.8.8.8",
      ),
      false,
    );
    expect(peer.proto).toBeUndefined();
    expect(peer.address).toBe("8.8.8.8");
  });

  test("takes the rightmost untrusted entry with a cidr list", () => {
    const peer = resolvePeer(
      incoming({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.7" }, "10.0.0.2"),
      ["10.0.0.0/8"],
    );
    expect(peer.address).toBe("1.2.3.4");
  });

  test("takes the leftmost entry when trustProxy is true", () => {
    const peer = resolvePeer(
      incoming({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }, "10.0.0.2"),
      true,
    );
    expect(peer.address).toBe("9.9.9.9");
  });

  test("counts hops from the right when trustProxy is a number", () => {
    const peer = resolvePeer(
      incoming({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 5.6.7.8" }, "10.0.0.2"),
      2,
    );
    expect(peer.address).toBe("1.2.3.4");
  });

  test("reads the Forwarded header in preference to x-forwarded-*", () => {
    const peer = resolvePeer(
      incoming(
        {
          forwarded: 'for=1.2.3.4;proto=https;host="app.example.com"',
          "x-forwarded-proto": "http",
        },
        "127.0.0.1",
      ),
      true,
    );
    expect(peer.proto).toBe("https");
    expect(peer.host).toBe("app.example.com");
    expect(peer.address).toBe("1.2.3.4");
  });
});
