import type { ContextStore } from "../router/context.ts";
import type { RouteInfo } from "../router/types.ts";

export type Platform = "web" | "ios" | "android";

const KEY = "__flypathRequest";

const DEV = process.env.NODE_ENV !== "production";

export type RequestInfo = RouteInfo & {
  platform: Platform;
  phase: "render" | "action";
  headers: Headers;
  outgoing: Headers;
  prefetch: boolean;
  context: ContextStore;
};

export type HeaderAccess = {
  (): Headers;
  set: (name: string, value: string) => void;
  delete: (name: string) => void;
};

export type RequestStore = { get: () => RequestInfo | undefined };

type Holder = {
  [KEY]?: RequestStore;
  __FLYPATH__?: { platform?: string };
};

const holder = globalThis as unknown as Holder;

export function setRequestStore(store: RequestStore): void {
  holder[KEY] = store;
}

export function parsePlatform(
  value: string | null | undefined,
): Platform | undefined {
  return value === "web" || value === "ios" || value === "android"
    ? value
    : undefined;
}

export function getRequest(): RequestInfo | undefined {
  return holder[KEY]?.get();
}

export function platform(): Platform {
  return (
    getRequest()?.platform ??
    parsePlatform(holder.__FLYPATH__?.platform) ??
    "web"
  );
}

function required(what: string): RequestInfo {
  const request = getRequest();
  if (!request) {
    throw new Error(
      `flypath: ${what}, so it is only available while the flypath router ` +
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
    `flypath: headers().${method}(${JSON.stringify(name)}) changes nothing; ` +
      "headers() is a copy of the incoming request headers. Write a header " +
      "on the response with headers.set() or headers.delete(), and a cookie " +
      "with cookies.set().",
  );
}

function reserved(name: string): void {
  const key = name.toLowerCase();
  if (key === "set-cookie") {
    throw new Error(
      'flypath: headers.set("set-cookie") would replace every cookie on ' +
        "the response at once; use cookies.set() and cookies.clear(), which " +
        "merge into what the rest of the request already wrote",
    );
  }
  if (key.startsWith("x-flypath-")) {
    throw new Error(
      `flypath: "${key}" belongs to the flypath wire protocol, which the ` +
        "client parses; pick a header name of your own",
    );
  }
  if (key === "content-type" || key === "location") {
    throw new Error(
      `flypath: "${key}" is decided by the response flypath builds — a ` +
        "flight payload, a document or a redirect — so overwriting it would " +
        "break the client; use navigate() to send the user elsewhere",
    );
  }
}

export const headers: HeaderAccess = Object.assign(
  (): Headers =>
    snapshot(required("headers() reads the incoming request").headers),
  {
    set: (name: string, value: string): void => {
      reserved(name);
      required("headers.set() writes a header on the response").outgoing.set(
        name,
        value,
      );
    },
    delete: (name: string): void => {
      reserved(name);
      required(
        "headers.delete() writes a header on the response",
      ).outgoing.delete(name);
    },
  },
);

export function isPrefetch(): boolean {
  return getRequest()?.prefetch ?? false;
}

export function isNative(): boolean {
  return platform() !== "web";
}

export function isIos(): boolean {
  return platform() === "ios";
}

export function isAndroid(): boolean {
  return platform() === "android";
}
