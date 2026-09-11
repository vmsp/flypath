import type { ContextStore } from "../router/context.ts";
import type { RouteInfo } from "../router/types.ts";
import { globals } from "../shared/globals.ts";

export type Platform = "web" | "ios" | "android";

const DEV = process.env.NODE_ENV !== "production";

export type RequestInfo = RouteInfo & {
  platform: Platform;
  phase: "render" | "action";
  headers: Headers;
  outgoing: Headers;
  prefetch: boolean;
  prerender: boolean;
  context: ContextStore;
};

export type HeaderAccess = {
  /** The incoming request's headers. */
  (): Headers;

  /** Set a header on the response. */
  set: (name: string, value: string) => void;

  /** Remove a header from the response. */
  delete: (name: string) => void;
};

export function parsePlatform(
  value: string | null | undefined,
): Platform | undefined {
  return value === "web" || value === "ios" || value === "android"
    ? value
    : undefined;
}

export function getRequest(): RequestInfo | undefined {
  return globals().requestStorage?.getStore();
}

/** Where the current render runs. */
export function platform(): Platform {
  return (
    getRequest()?.platform ??
    parsePlatform(globalThis.__FLYPATH__?.platform) ??
    "web"
  );
}

function required(what: string): RequestInfo {
  const request = getRequest();
  if (!request) {
    throw new Error(
      `${what}, so it is only available while the flypath router ` +
        "is handling a request — in a middleware, a server component or a " +
        "server action",
    );
  }
  return request;
}

let Snapshot: (new (init: Headers) => Headers) | undefined;

function snapshot(incoming: Headers): Headers {
  if (!DEV) return new Headers(incoming);
  Snapshot ??= class extends Headers {
    override set(name: string): void {
      complain("set", name);
    }

    override append(name: string): void {
      complain("append", name);
    }

    override delete(name: string): void {
      complain("delete", name);
    }
  };
  return new Snapshot(incoming);
}

function complain(method: string, name: string): void {
  console.warn(
    `headers().${method}(${JSON.stringify(name)}) changes nothing; ` +
      "headers() is a copy of the incoming request headers. Write a header " +
      "on the response with headers.set() or headers.delete(), and a cookie " +
      "with cookies.set().",
  );
}

function reserved(name: string): void {
  const key = name.toLowerCase();
  if (key === "set-cookie") {
    throw new Error(
      'headers.set("set-cookie") would replace every cookie on ' +
        "the response at once; use cookies.set() and cookies.clear(), which " +
        "merge into what the rest of the request already wrote",
    );
  }
  if (key.startsWith("x-flypath-")) {
    throw new Error(
      `"${key}" belongs to the flypath wire protocol, which the ` +
        "client parses; pick a header name of your own",
    );
  }
  if (key === "content-type" || key === "location") {
    throw new Error(
      `"${key}" is decided by the response flypath builds — a ` +
        "flight payload, a document or a redirect — so overwriting it would " +
        "break the client; use navigate() to send the user elsewhere",
    );
  }
}

export const VISITOR: string =
  "a prerendered page is rendered once and served to everyone, so it cannot " +
  "depend on who is asking — drop prerender from the route, or move the part " +
  'that needs the visitor into a "use client" component';

export const EFFECT: string =
  "a prerendered page is rendered during the build, and again every time the " +
  "server renders it on demand, so an effect here runs at moments nobody " +
  "chose — move it into a server action, a job or a middleware";

export function forbidPrerender(call: string, why: string): void {
  const request = getRequest();
  if (!request?.prerender) return;
  throw new Error(`${call} while prerendering ${request.pathname}; ${why}`);
}

export const headers: HeaderAccess = Object.assign(
  (): Headers => {
    forbidPrerender("headers() was read", VISITOR);
    return snapshot(required("headers() reads the incoming request").headers);
  },
  {
    set: (name: string, value: string): void => {
      forbidPrerender("headers.set() was called", VISITOR);
      reserved(name);
      required("headers.set() writes a header on the response").outgoing.set(
        name,
        value,
      );
    },
    delete: (name: string): void => {
      forbidPrerender("headers.delete() was called", VISITOR);
      reserved(name);
      required(
        "headers.delete() writes a header on the response",
      ).outgoing.delete(name);
    },
  },
);

/** Whether this render only warms a cache and isn't shown yet. */
export function isPrefetch(): boolean {
  return getRequest()?.prefetch ?? false;
}

/** Whether this render is a prerender, which reads nothing of the request. */
export function isPrerendering(): boolean {
  return getRequest()?.prerender ?? false;
}

/** Whether the current platform is iOS or Android. */
export function isNative(): boolean {
  return platform() !== "web";
}

/** Whether the current platform is iOS. */
export function isIos(): boolean {
  return platform() === "ios";
}

/** Whether the current platform is Android. */
export function isAndroid(): boolean {
  return platform() === "android";
}
