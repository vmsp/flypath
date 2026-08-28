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

import type { NavigationSignal } from "../router/navigation.ts";
import { navigationSignal } from "../router/navigation.ts";
import { normalizePath, searchParamsOf } from "../router/path.ts";
import type { RscPayload } from "./payload.ts";
import { runWithRequest } from "./platform-store.ts";
import { parsePlatform } from "./platform.ts";
import type { ScreenRender } from "./router-server.tsx";
import {
  fallbackRoute,
  renderChrome,
  renderMatch,
  renderScreen,
  resolveTree,
  withSafeArea,
} from "./router-server.tsx";

import "virtual:flypath/styles.css";

const FLIGHT_CONTENT_TYPE = "text/x-component;charset=utf-8";

function documentShell(children: ReactNode, title: string): ReactNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>{title}</title>
        {import.meta.viteRsc.loadCss()}
      </head>
      <body>{children}</body>
    </html>
  );
}

type ActionResult = { returnValue?: unknown; formState?: unknown };

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
  const result = await (action as () => Promise<unknown>)();
  return { formState: await decodeFormState(result, formData) };
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

function redirectResponse(
  signal: Extract<NavigationSignal, { kind: "redirect" }>,
  document: boolean,
): Response {
  return new Response(null, {
    status: signal.status,
    headers: document
      ? { location: signal.to }
      : { "x-flypath-redirect": signal.to },
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

  return runWithRequest({ platform, pathname }, async () => {
    const resolved = resolveTree(tree);
    const screen =
      request.headers.get("x-flypath-screen") ??
      url.searchParams.get("__flypath_screen");

    const temporaryReferences = createTemporaryReferenceSet();
    const action: ActionResult =
      request.method === "POST"
        ? await runAction(request, temporaryReferences)
        : {};

    const wantsFlight =
      platform !== "web" ||
      screen !== null ||
      url.searchParams.has("__flight") ||
      request.headers.has("x-rsc-action");

    if (screen === "chrome") {
      const chrome = await toFlight(
        { root: await renderChrome(resolved) },
        temporaryReferences,
      );
      return new Response(replay(chrome.bytes), {
        headers: { "content-type": FLIGHT_CONTENT_TYPE },
      });
    }

    const searchParams = searchParamsOf(url);
    const boundary = screen === null ? undefined : screen;

    const compose = (rendering: ScreenRender): Promise<Rendered> => {
      const content =
        platform === "web"
          ? withSafeArea(rendering.route, rendering.node)
          : rendering.node;
      const title = rendering.route.options.title ?? "Flypath";
      return toFlight(
        {
          root:
            platform === "web" && screen === null
              ? documentShell(content, title)
              : content,
          returnValue: action.returnValue,
          formState: action.formState,
        },
        temporaryReferences,
      );
    };

    let match = await renderScreen(resolved, pathname, searchParams, boundary);
    let rendered = match ? await compose(match) : undefined;

    if (rendered?.signal?.kind === "redirect") {
      return redirectResponse(rendered.signal, !wantsFlight);
    }

    let status = match?.route.pattern === "/*" ? 404 : 200;
    if (!match || rendered?.signal?.kind === "not-found") {
      status = 404;
      const fallback = fallbackRoute(resolved);
      if (!fallback || fallback === match?.route) return plainNotFound();
      match = await renderMatch(
        resolved,
        fallback,
        { "*": pathname.replace(/^\//, "") },
        searchParams,
        boundary,
      );
      rendered = await compose(match);
      if (rendered.signal?.kind === "not-found") return plainNotFound();
    }

    if (!match || !rendered) return plainNotFound();

    const headers: Record<string, string> = {
      "x-flypath-route": JSON.stringify({
        id: match.route.id,
        params: match.params,
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
        pathname,
        params: match.params,
      }),
      {
        status,
        headers: { ...headers, "content-type": "text/html;charset=utf-8" },
      },
    );
  });
}
