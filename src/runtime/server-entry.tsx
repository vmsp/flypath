import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from "@vitejs/plugin-rsc/rsc";
import type { ReactNode } from "react";
import { tree } from "virtual:flypath/routes";

import {
  ACTION_HEADER,
  CHROME_HEADER,
  FRAGMENT_HEADER,
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  PLATFORM_HEADER,
  PREFETCH_HEADER,
  REVALIDATE_HEADER,
  SCREEN_HEADER,
} from "../protocol/headers.ts";
import { FLIGHT_PARAM } from "../protocol/params.ts";
import { createContextStore } from "../router/context.ts";
import type { FlatRoute } from "../router/flatten.ts";
import { hasChrome, matchRoutes } from "../router/flatten.ts";
import { declaredContainer, ROOT_CONTAINER } from "../router/manifest.ts";
import { runMiddleware } from "../router/middleware.ts";
import type { NavigationSignal } from "../router/navigation.ts";
import {
  encodeCommand,
  encodeLocation,
  navigationSignal,
} from "../router/navigation.ts";
import { hrefOf, normalizePath, searchOf } from "../router/path.ts";
import { parseRevalidate } from "../router/revalidate.ts";
import type { RouteInfo } from "../router/types.ts";
import { mergeCookies } from "./cookies.ts";
import type { RscPayload } from "./payload.ts";
import { runWithRequest } from "./platform-store.ts";
import type { RequestInfo } from "./platform.ts";
import { parsePlatform } from "./platform.ts";
import type { ScreenRender } from "./router-server.tsx";
import {
  renderFragment,
  renderMatch,
  renderScreen,
  resolveTree,
  withSafeArea,
} from "./router-server.tsx";

import "virtual:flypath/styles.css";

const FLIGHT_CONTENT_TYPE = "text/x-component;charset=utf-8";

const REDIRECT_BUDGET = 5;

function requestedChrome(value: string | null): readonly string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

function documentShell(children: ReactNode): ReactNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        {import.meta.viteRsc.loadCss()}
      </head>
      <body>{children}</body>
    </html>
  );
}

type Redirect = Exclude<NavigationSignal, { kind: "not-found" }>;

type Go = Extract<NavigationSignal, { kind: "go" }>;

type ActionResult = {
  returnValue?: unknown;
  formState?: unknown;
  signal?: NavigationSignal;
};

type Dispatched = {
  response: Response;
  signal: Redirect | undefined;
};

function deferred(error: unknown): Promise<never> {
  const rejected = Promise.reject(error);
  rejected.catch(() => {});
  return rejected;
}

async function runAction(
  request: Request,
  temporaryReferences: unknown,
): Promise<ActionResult> {
  const id = request.headers.get(ACTION_HEADER);

  if (id !== null) {
    const contentType = request.headers.get("content-type") ?? "";
    const body: unknown = contentType.startsWith("multipart/form-data")
      ? await request.formData()
      : await request.text();
    const args = await decodeReply(
      body as string,
      {
        temporaryReferences,
      } as never,
    );
    const action = await loadServerAction(id);
    try {
      return {
        returnValue: await (action as (...a: unknown[]) => unknown)(...args),
      };
    } catch (error) {
      const signal = navigationSignal(error);
      if (signal) return { signal };
      return { returnValue: deferred(error) };
    }
  }

  const formData = (await request.formData()) as unknown as FormData;
  const action = await decodeAction(formData);
  try {
    const result = await (action as () => Promise<unknown>)();
    return { formState: await decodeFormState(result, formData) };
  } catch (error) {
    const signal = navigationSignal(error);
    if (!signal) throw error;
    return { signal };
  }
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function replay(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

type Rendered = {
  bytes: Uint8Array;
  signal: NavigationSignal | undefined;
};

async function toFlight(
  payload: RscPayload,
  temporaryReferences: unknown,
): Promise<Rendered> {
  let signal: NavigationSignal | undefined;
  const stream = renderToReadableStream<RscPayload>(payload, {
    temporaryReferences,
    onError: (error: unknown) => {
      signal ??= navigationSignal(error);
    },
  } as never);
  return { bytes: await collect(stream), signal };
}

function navigateResponse(
  signal: Redirect,
  document: boolean,
  request: Request,
): Response {
  if (!document) {
    return new Response(null, {
      status: 204,
      headers: { [NAVIGATE_HEADER]: encodeCommand(signal) },
    });
  }

  const to =
    signal.kind === "back"
      ? (request.headers.get("referer") ?? "/")
      : signal.to;
  return new Response(null, {
    status: signal.kind === "go" && signal.permanent ? 308 : 307,
    headers: { location: to },
  });
}

function plainNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain;charset=utf-8" },
  });
}

function withCommand(response: Response, signal: Redirect): Response {
  const headers = new Headers(response.headers);
  headers.set(NAVIGATE_HEADER, encodeCommand(signal));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withOutgoing(response: Response, outgoing: Headers): Response {
  const jar = outgoing.getSetCookie();
  const entries = [...outgoing].filter(([key]) => key !== "set-cookie");
  if (entries.length === 0 && jar.length === 0) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of entries) headers.set(key, value);
  for (const value of jar) headers.append("set-cookie", value);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const platform = parsePlatform(request.headers.get(PLATFORM_HEADER)) ?? "web";

  const resolved = resolveTree(tree);

  const screen = request.headers.get(SCREEN_HEADER);

  const fragment = request.headers.get(FRAGMENT_HEADER);

  const chrome = requestedChrome(request.headers.get(CHROME_HEADER));

  const wantsFlight =
    platform !== "web" ||
    screen !== null ||
    url.searchParams.has(FLIGHT_PARAM) ||
    request.headers.has(ACTION_HEADER);

  const document = !wantsFlight;
  const temporaryReferences = createTemporaryReferenceSet();
  const outgoing = new Headers();
  const incoming = new Headers(request.headers);
  const prefetch = request.headers.has(PREFETCH_HEADER);

  let action: ActionResult = {};

  const dispatch = (
    href: string,
    container: string | undefined,
    runsAction: boolean,
  ): Promise<Dispatched> => {
    const at = new URL(href, url.origin);
    const pathname = normalizePath(at.pathname);
    const matched = matchRoutes(resolved.routes, pathname);

    const base: RouteInfo = {
      pathname,
      params: matched?.params ?? {},
      search: searchOf(at),
    };

    const info: RequestInfo = {
      ...base,
      platform,
      phase: "render",
      headers: new Headers(incoming),
      outgoing,
      prefetch,
      context: createContextStore(),
    };

    let signal: Redirect | undefined;

    return runWithRequest(info, async () => {
      const fragments = async (
        rendering: ScreenRender,
      ): Promise<Record<string, ReactNode> | undefined> => {
        if (chrome.length === 0 || !wantsFlight || fragment !== null) {
          return undefined;
        }
        const allowed = new Set(rendering.route.placement);
        const out: Record<string, ReactNode> = {};
        for (const id of chrome) {
          if (!allowed.has(id)) continue;
          const container = resolved.containers.get(id);
          if (!container || !hasChrome(resolved.containers, container)) {
            continue;
          }
          out[id] = await renderFragment(resolved, id, rendering.info);
        }
        return Object.keys(out).length === 0 ? undefined : out;
      };

      const compose = async (rendering: ScreenRender): Promise<Rendered> => {
        const content =
          platform === "web"
            ? withSafeArea(rendering.route, rendering.node)
            : rendering.node;
        const around = await fragments(rendering);
        return runWithRequest({ ...info, ...rendering.info }, () =>
          toFlight(
            {
              root:
                platform === "web" && screen === null
                  ? documentShell(content)
                  : content,
              ...(around === undefined ? {} : { fragments: around }),
              returnValue: action.returnValue,
              formState: action.formState,
            },
            temporaryReferences,
          ),
        );
      };

      const finish = async (
        match: ScreenRender,
        rendered: Rendered,
        status: number,
      ): Promise<Response> => {
        const headers: Record<string, string> = {
          [LOCATION_HEADER]: encodeLocation({
            url: href,
            container,
            route: match.route.id,
            params: match.info.params,
          }),
        };

        if (wantsFlight) {
          return new Response(replay(rendered.bytes), {
            status,
            headers: { ...headers, "content-type": FLIGHT_CONTENT_TYPE },
          });
        }

        const ssr = await import.meta.viteRsc.loadModule<
          typeof import("./ssr-entry.tsx")
        >("ssr", "index");

        return new Response(
          await ssr.handleSsr(replay(rendered.bytes), {
            formState: action.formState,
          }),
          {
            status,
            headers: { ...headers, "content-type": "text/html;charset=utf-8" },
          },
        );
      };

      const missing = async (
        current: FlatRoute | undefined,
      ): Promise<Response> => {
        const fallback = resolved.fallback;
        if (!fallback || fallback === current) return plainNotFound();

        const match = await renderMatch(
          resolved,
          fallback,
          { ...base, params: {} },
          container,
        );
        const rendered = await compose(match);
        if (rendered.signal?.kind === "not-found") return plainNotFound();
        return finish(match, rendered, 404);
      };

      const redirect = (value: Redirect): Response => {
        signal = value;
        return navigateResponse(value, document, request);
      };

      const answer = async (value: NavigationSignal): Promise<Response> =>
        value.kind === "not-found" ? missing(undefined) : redirect(value);

      const render = async (): Promise<Response> => {
        if (runsAction && request.method === "POST") {
          action = await runWithRequest({ ...info, phase: "action" }, () =>
            runAction(request, temporaryReferences),
          );
        }

        if (fragment !== null) {
          const rendering = await toFlight(
            { root: await renderFragment(resolved, fragment, base) },
            temporaryReferences,
          );
          return new Response(replay(rendering.bytes), {
            headers: { "content-type": FLIGHT_CONTENT_TYPE },
          });
        }

        const invalidation = parseRevalidate(outgoing.get(REVALIDATE_HEADER));

        if (action.signal && action.signal.kind !== "not-found") {
          if (invalidation === "none") {
            outgoing.delete(REVALIDATE_HEADER);
            if (import.meta.env.DEV) {
              console.warn(
                "flypath: revalidate.none() ran in an action that also " +
                  "navigated; the destination is rendered fresh either way, " +
                  "so the opt-out is ignored",
              );
            }
          }
          return redirect(action.signal);
        }

        if (invalidation === "none" && wantsFlight) {
          const rendering = await toFlight(
            {
              root: null,
              returnValue: action.returnValue,
              formState: action.formState,
            },
            temporaryReferences,
          );
          return new Response(replay(rendering.bytes), {
            headers: { "content-type": FLIGHT_CONTENT_TYPE },
          });
        }

        const match = await renderScreen(resolved, base, container);
        const rendered = match ? await compose(match) : undefined;
        const rendering = rendered?.signal;

        if (rendering && rendering.kind !== "not-found") {
          return redirect(rendering);
        }

        if (
          !match ||
          !rendered ||
          rendering?.kind === "not-found" ||
          action.signal?.kind === "not-found"
        ) {
          return missing(match?.route);
        }

        return finish(match, rendered, 200);
      };

      const chain = (matched?.route ?? resolved.fallback)?.middleware ?? [];

      const response = await runMiddleware(
        chain,
        async () => {
          info.context.open = false;
          try {
            return await render();
          } finally {
            info.context.open = true;
          }
        },
        answer,
      );

      return { response, signal };
    });
  };

  const containerFor = (pathname: string): string => {
    const matched = matchRoutes(resolved.routes, pathname);
    const placement = matched?.route.placement ??
      resolved.fallback?.placement ?? [ROOT_CONTAINER];
    return declaredContainer(placement);
  };

  const start = hrefOf(url);
  const trail: string[] = [start];

  let href = start;
  let container = screen === null ? undefined : screen;
  let first: Go | undefined;

  for (let hop = 0; ; hop += 1) {
    const { response, signal } = await dispatch(href, container, hop === 0);

    if (!signal) {
      return withOutgoing(
        first ? withCommand(response, { ...first, to: href }) : response,
        outgoing,
      );
    }

    action = { returnValue: action.returnValue, formState: action.formState };

    if (fragment !== null) {
      if (import.meta.env.DEV) {
        throw new Error(
          `flypath: the chrome of container "${fragment}" redirected while ` +
            "rendering; a fragment renders around a URL whose guards have " +
            "already passed, so following it would let the chrome navigate " +
            "the app",
        );
      }
      return withOutgoing(response, outgoing);
    }

    if (document || signal.kind === "back") {
      return withOutgoing(response, outgoing);
    }

    const next = new URL(signal.to, url.origin);
    if (next.origin !== url.origin) return withOutgoing(response, outgoing);

    first ??= signal;
    href = hrefOf(next);
    trail.push(href);

    if (trail.length > REDIRECT_BUDGET) {
      if (import.meta.env.DEV) {
        throw new Error(
          `flypath: redirect budget exhausted after ${String(
            REDIRECT_BUDGET,
          )} hops: ${trail.join(" → ")}`,
        );
      }
      return withOutgoing(response, outgoing);
    }

    const jar = mergeCookies(
      request.headers.get("cookie"),
      outgoing.getSetCookie(),
    );
    if (jar === "") incoming.delete("cookie");
    else incoming.set("cookie", jar);

    if (container !== undefined) {
      container = containerFor(normalizePath(next.pathname));
    }
  }
}
