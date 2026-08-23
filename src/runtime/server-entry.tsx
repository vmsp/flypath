import { renderToReadableStream } from "@vitejs/plugin-rsc/rsc";
import type { ComponentType, ReactNode } from "react";

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

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const platform =
    parsePlatform(request.headers.get("x-flypath-platform")) ??
    parsePlatform(url.searchParams.get("platform")) ??
    "web";

  return runWithPlatform(platform, async () => {
    const load = routes[routeId(url.pathname)];
    if (!load) return new Response("Not Found", { status: 404 });

    const Page = (await load()).default;
    const wantsFlight = platform !== "web" || url.searchParams.has("__flight");

    const rscStream = renderToReadableStream<ReactNode>(
      platform === "web" ? documentShell(<Page />) : <Page />,
    );

    if (wantsFlight) {
      return new Response(rscStream, {
        headers: { "content-type": FLIGHT_CONTENT_TYPE },
      });
    }

    const ssr = await import.meta.viteRsc.loadModule<
      typeof import("./ssr-entry.tsx")
    >("ssr", "index");

    return new Response(await ssr.handleSsr(rscStream), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  });
}
