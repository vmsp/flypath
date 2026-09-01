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

import { matchRoutes } from "../router/flatten.ts";
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
  const info = { ...base, platform, phase: "render" as const };

  return runWithRequest(info, async () => {
    const screen =
      request.headers.get("x-flypath-screen") ??
      url.searchParams.get("__flypath_screen");

    const temporaryReferences = createTemporaryReferenceSet();
    const action: ActionResult =
      request.method === "POST"
        ? await runWithRequest({ ...info, phase: "action" }, () =>
            runAction(request, temporaryReferences),
          )
        : {};

    const wantsFlight =
      platform !== "web" ||
      screen !== null ||
      url.searchParams.has("__flight") ||
      request.headers.has("x-rsc-action");

    const fragment =
      request.headers.get("x-flypath-fragment") ??
      url.searchParams.get("__flypath_fragment");

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

    const container = screen === null ? undefined : screen;

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

    let match = await renderScreen(resolved, base, container);
    let rendered = match ? await compose(match) : undefined;
    const signal = rendered?.signal;

    if (signal && signal.kind !== "not-found") {
      return navigateResponse(signal, !wantsFlight, request);
    }

    let status = 200;
    if (
      !match ||
      signal?.kind === "not-found" ||
      action.signal?.kind === "not-found"
    ) {
      status = 404;
      const fallback = resolved.fallback;
      if (!fallback || fallback === match?.route) return plainNotFound();
      match = await renderMatch(
        resolved,
        fallback,
        { ...base, params: {} },
        container,
      );
      rendered = await compose(match);
      if (rendered.signal?.kind === "not-found") return plainNotFound();
    }

    if (!match || !rendered) return plainNotFound();

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
  });
}
