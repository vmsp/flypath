import fs from "node:fs";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import type { RouteManifest } from "../router/manifest.ts";
import { StaticError } from "./eval.ts";
import { parseRouteTree, routeManifest } from "./route-extract.ts";

const ROUTES = "virtual:flypath/routes";
const ROUTES_ID = `\0${ROUTES}`;
const MANIFEST = "virtual:flypath/route-manifest";
const MANIFEST_ID = `\0${MANIFEST}`;

const CANDIDATES = ["app/routes.ts", "app/routes.tsx"];

export function findRoutesFile(root: string): string {
  for (const candidate of CANDIDATES) {
    const file = path.join(root, candidate);
    if (fs.existsSync(file)) return file;
  }
  throw new Error(
    `flypath: no route configuration found — create ${path.join(
      root,
      "app/routes.ts",
    )}`,
  );
}

export function routes(): Plugin {
  let root = process.cwd();
  let server: ViteDevServer | undefined;
  let cached: RouteManifest | undefined;
  let file: string | undefined;

  const routesFile = (): string => {
    file ??= findRoutesFile(root);
    return file;
  };

  const manifest = (): RouteManifest => {
    if (cached) return cached;
    const target = routesFile();
    const code = fs.readFileSync(target, "utf8");
    try {
      cached = routeManifest(parseRouteTree(target, code));
    } catch (error) {
      if (error instanceof StaticError) {
        throw new Error(
          `${error.message} (${path.relative(root, target)})\n` +
            "flypath: route options must be statically analyzable",
        );
      }
      throw error;
    }
    return cached;
  };

  const invalidate = (): void => {
    cached = undefined;
    if (!server) return;
    for (const environment of Object.values(server.environments)) {
      const module = environment.moduleGraph.getModuleById(MANIFEST_ID);
      if (module) environment.moduleGraph.invalidateModule(module);
    }
    server.hot.send({ type: "full-reload" });
  };

  return {
    name: "flypath:routes",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    configureServer(value) {
      server = value;
    },
    buildStart() {
      manifest();
      this.addWatchFile(routesFile());
    },
    watchChange(id) {
      if (file !== undefined && path.resolve(id) === file) invalidate();
    },
    resolveId(source) {
      if (source === ROUTES) return ROUTES_ID;
      if (source === MANIFEST) return MANIFEST_ID;
      return undefined;
    },
    load(id) {
      if (id === ROUTES_ID) {
        if (this.environment.name !== "rsc") {
          throw new Error(
            `flypath: "${ROUTES}" is only available in the server environment`,
          );
        }
        return `export { default as tree } from ${JSON.stringify(routesFile())};\n`;
      }
      if (id === MANIFEST_ID) {
        return `export const manifest = ${JSON.stringify(manifest())};\nexport default manifest;\n`;
      }
      return undefined;
    },
  };
}
