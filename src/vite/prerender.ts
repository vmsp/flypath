import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Plugin } from "vite";

import type { RouteManifest } from "../router/manifest.ts";
import type { Prerendered } from "../runtime/prerender.ts";
import { flightPath } from "../shared/flight.ts";
import { step } from "../terminal/output.ts";
import { plural } from "../terminal/style.ts";
import { ROUTES_PLUGIN } from "./routes.ts";

type RoutesApi = { manifest: () => RouteManifest };

export type OutputFiles = {
  path: string;
  document: string;
  flight: string;
};

export function prerenderFiles(paths: readonly string[]): OutputFiles[] {
  const claimed = new Map<string, string>();
  const out: OutputFiles[] = [];

  for (const at of paths) {
    const base = at === "/" ? "" : `${at.slice(1)}/`;
    const files: OutputFiles = {
      path: at,
      document: `${base}index.html`,
      flight: flightPath(at).slice(1),
    };

    for (const file of [files.document, files.flight]) {
      const owner = claimed.get(file);
      if (owner !== undefined) {
        throw new Error(
          `${at} and ${owner} are both prerendered to ${file}; two ` +
            "routes cannot share one file — rename one of the patterns",
        );
      }
      claimed.set(file, at);
    }

    out.push(files);
  }

  return out;
}

function write(dir: string, file: string, body: string | Uint8Array): void {
  const target = path.join(dir, file);
  if (fs.existsSync(target)) {
    throw new Error(
      `Prerendering would overwrite ${file}, which the client ` +
        "build already wrote; a prerendered route may not take the name of " +
        "an asset — rename the route",
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

export function prerender(): Plugin {
  return {
    name: "flypath:prerender",
    buildApp: {
      order: "post",
      async handler(builder) {
        const routes = builder.config.plugins.find(
          (entry) => entry.name === ROUTES_PLUGIN,
        );
        const manifest = (routes?.api as RoutesApi | undefined)?.manifest();
        if (!manifest) return;

        const paths = manifest.routes
          .filter((route) => route.options.prerender === true)
          .map((route) => route.pattern);
        if (paths.length === 0) return;

        const files = prerenderFiles(paths);

        const root = builder.config.root;
        const rsc = path.resolve(
          root,
          builder.environments["rsc"]?.config.build.outDir ?? "dist/rsc",
        );
        const client = path.resolve(
          root,
          builder.environments["client"]?.config.build.outDir ?? "dist/client",
        );

        const entry = path.join(rsc, "index.js");
        const module = (await import(pathToFileURL(entry).href)) as {
          prerender?: (paths: readonly string[]) => Promise<Prerendered[]>;
        };
        if (!module.prerender) {
          throw new Error(
            `${entry} does not export prerender(); the server build ` +
              "is stale — build it again",
          );
        }

        const render = module.prerender;
        const { closePools } = await import("../db/client.ts");
        try {
          await step(
            {
              active: "Prerendering",
              done: `Prerendered ${plural(files.length, "page")}`,
            },
            async (progress) => {
              for (const [at, target] of files.entries()) {
                progress.status(
                  `${String(at + 1)}/${String(files.length)} ${target.path}`,
                );
                const [page] = await render([target.path]);
                if (!page) continue;
                write(client, target.document, page.document);
                write(client, target.flight, page.flight);
              }
            },
          );
        } finally {
          await closePools();
        }
      },
    },
  };
}
