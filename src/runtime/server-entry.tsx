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

import { createContextStore } from "../router/context.ts";
import type { FlatRoute } from "../router/flatten.ts";
import { matchRoutes } from "../router/flatten.ts";
import { runMiddleware } from "../router/middleware.ts";
import type { NavigationSignal } from "../router/navigation.ts";
import {
  encodeCommand,
  NAVIGATE_HEADER,
  navigationSignal,
} from "../router/navigation.ts";
import { normalizePath, searchOf } from "../router/path.ts";
import type { RouteInfo } from "../router/types.ts";
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

type ActionResult = {
  returnValue?: unknown;
  formState?: unknown;
  signal?: NavigationSignal;
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
  const id = request.headers.get("x-rsc-action");

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
  signal: Exclude<NavigationSignal, { kind: "not-found" }>,
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
  const platform =
    parsePlatform(request.headers.get("x-flypath-platform")) ??
    parsePlatform(url.searchParams.get("platform")) ??
    "web";

  const pathname = normalizePath(url.pathname);
  const search = searchOf(url);
  const resolved = resolveTree(tree);
  const matched = matchRoutes(resolved.routes, pathname);

  const base: RouteInfo = { pathname, params: matched?.params ?? {}, search };
  const info: RequestInfo = {
    ...base,
    platform,
    phase: "render",
    headers: new Headers(request.headers),
    outgoing: new Headers(),
    prefetch: request.headers.has("x-flypath-prefetch"),
    context: createContextStore(),
  };

  return runWithRequest(info, async () => {
    const screen =
      request.headers.get("x-flypath-screen") ??
      url.searchParams.get("__flypath_screen");
    const container = screen === null ? undefined : screen;

    const fragment =
      request.headers.get("x-flypath-fragment") ??
      url.searchParams.get("__flypath_fragment");

    const temporaryReferences = createTemporaryReferenceSet();

    const wantsFlight =
      platform !== "web" ||
      screen !== null ||
      url.searchParams.has("__flight") ||
      request.headers.has("x-rsc-action");

    let action: ActionResult = {};

    const compose = (rendering: ScreenRender): Promise<Rendered> => {
      const content =
        platform === "web"
          ? withSafeArea(rendering.route, rendering.node)
          : rendering.node;
      return runWithRequest({ ...info, ...rendering.info }, () =>
        toFlight(
          {
            root:
              platform === "web" && screen === null
                ? documentShell(content)
                : content,
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
        "x-flypath-route": JSON.stringify({
          id: match.route.id,
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

    const answer = async (signal: NavigationSignal): Promise<Response> =>
      signal.kind === "not-found"
        ? missing(undefined)
        : navigateResponse(signal, !wantsFlight, request);

    const render = async (): Promise<Response> => {
      action =
        request.method === "POST"
          ? await runWithRequest({ ...info, phase: "action" }, () =>
              runAction(request, temporaryReferences),
            )
          : {};

      if (fragment !== null) {
        const rendering = await toFlight(
          { root: await renderFragment(resolved, fragment, base) },
          temporaryReferences,
        );
        return new Response(replay(rendering.bytes), {
          headers: { "content-type": FLIGHT_CONTENT_TYPE },
        });
      }

      if (action.signal && action.signal.kind !== "not-found") {
        return navigateResponse(action.signal, !wantsFlight, request);
      }

      const match = await renderScreen(resolved, base, container);
      const rendered = match ? await compose(match) : undefined;
      const signal = rendered?.signal;

      if (signal && signal.kind !== "not-found") {
        return navigateResponse(signal, !wantsFlight, request);
      }

      if (
        !match ||
        !rendered ||
        signal?.kind === "not-found" ||
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

    return withOutgoing(response, info.outgoing);
  });
}
