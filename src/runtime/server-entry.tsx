import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from "@vitejs/plugin-rsc/rsc";
import type { ComponentType, ReactNode } from "react";

import type { RscPayload } from "./payload.ts";
import { parsePlatform, runWithPlatform } from "./platform.ts";

import "virtual:flypath/styles.css";

const FLIGHT_CONTENT_TYPE = "text/x-component;charset=utf-8";

const routes = import.meta.glob<{ default: ComponentType }>(
  "/app/**/index.tsx",
);

function routeId(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "");
  return clean === "" ? "/app/index.tsx" : `/app${clean}/index.tsx`;
}

function documentShell(children: ReactNode): ReactNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>Flypath</title>
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

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const platform =
    parsePlatform(request.headers.get("x-flypath-platform")) ??
    parsePlatform(url.searchParams.get("platform")) ??
    "web";

  return runWithPlatform(platform, async () => {
    const load = routes[routeId(url.pathname)];
    if (!load) return new Response("Not Found", { status: 404 });

    const temporaryReferences = createTemporaryReferenceSet();
    const action: ActionResult =
      request.method === "POST"
        ? await runAction(request, temporaryReferences)
        : {};

    const Page = (await load()).default;
    const wantsFlight =
      platform !== "web" ||
      url.searchParams.has("__flight") ||
      request.headers.has("x-rsc-action");

    const rscStream = renderToReadableStream<RscPayload>(
      {
        root: platform === "web" ? documentShell(<Page />) : <Page />,
        returnValue: action.returnValue,
        formState: action.formState,
      },
      { temporaryReferences },
    );

    if (wantsFlight) {
      return new Response(rscStream, {
        headers: { "content-type": FLIGHT_CONTENT_TYPE },
      });
    }

    const ssr = await import.meta.viteRsc.loadModule<
      typeof import("./ssr-entry.tsx")
    >("ssr", "index");

    return new Response(
      await ssr.handleSsr(rscStream, { formState: action.formState }),
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  });
}
