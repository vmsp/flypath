import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin, ViteDevServer } from "vite";

import { attachDevMiddleware } from "./dev-middleware.ts";
import { FlypathSocket, HotSocket, MessageSocket } from "./metro-sockets.ts";
import type { NativePlatform } from "./native-env.ts";
import { isNativePlatform } from "./native-env.ts";
import { NativeServer } from "./native-serve.ts";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string,
): void {
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.end(body);
}

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use client\1/;

function isClientModule(file: string): boolean {
  if (!/\.[jt]sx?$/.test(file)) return false;
  try {
    return USE_CLIENT.test(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

function chunkMapPath(platform: string, reference: string): string {
  return `/chunk/${platform}/${encodeURIComponent(reference)}.map`;
}

function parseChunkPath(pathname: string):
  | {
      platform: NativePlatform;
      reference: string;
      kind: "bundle" | "map";
    }
  | undefined {
  const match = /^\/chunk\/([^/]+)\/(.+)\.(bundle|map)$/.exec(pathname);
  if (!match) return undefined;
  const platform = match[1] as string;
  if (!isNativePlatform(platform as never)) return undefined;
  return {
    platform: platform as NativePlatform,
    reference: decodeURIComponent(match[2] as string),
    kind: match[3] as "bundle" | "map",
  };
}

function platformOf(url: URL): NativePlatform | undefined {
  const value = url.searchParams.get("platform");
  return value !== null && isNativePlatform(value as never)
    ? (value as NativePlatform)
    : undefined;
}

export function metroEndpoints(distDir: string): Plugin {
  return {
    name: "flypath:metro-endpoints",
    configureServer(server: ViteDevServer) {
      const native = new NativeServer(server, distDir);
      const hot = new HotSocket(server.config.logger);
      const message = new MessageSocket();
      const flypath = new FlypathSocket();
      const baseUrl = native.serverUrl();
      const devUpgrades = attachDevMiddleware(server, baseUrl);

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", baseUrl);
        if (url.pathname === "/hot") {
          hot.handleUpgrade(request, socket, head);
          return;
        }
        if (url.pathname === "/message") {
          message.handleUpgrade(request, socket, head);
          return;
        }
        if (url.pathname === "/flypath") {
          flypath.handleUpgrade(request, socket, head);
          return;
        }
        const upgrade = devUpgrades.get(url.pathname);
        if (upgrade) upgrade(request, socket, head);
      });

      server.watcher.on("change", (file) => {
        void (async () => {
          try {
            const rsc = server.environments["rsc"];
            if (
              (rsc?.moduleGraph.getModulesByFile(file)?.size ?? 0) > 0 &&
              !isClientModule(file)
            ) {
              flypath.rscUpdate();
            }

            if (native.isChunkModule(file)) native.invalidateChunks();

            const updates = await native.hotUpdate(file);
            if (updates.length === 0) return;
            hot.updateStart();
            for (const { update } of updates) {
              hot.update({
                revisionId: String(Date.now()),
                isInitialUpdate: false,
                added: [],
                modified: [
                  {
                    module: [update.moduleId, update.code],
                    sourceURL: update.sourceURL,
                  },
                ],
                deleted: [],
              });
            }
            hot.updateDone();
          } catch (error) {
            hot.error(String(error));
            server.config.logger.error(String(error));
          }
        })();
      });

      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", baseUrl);

        if (url.pathname === "/status") {
          response.setHeader("X-React-Native-Project-Root", server.config.root);
          send(response, 200, "text/plain", "packager-status:running");
          return;
        }

        if (url.pathname === "/reload") {
          message.reload();
          send(response, 200, "text/plain", "OK");
          return;
        }

        const chunkRoute = parseChunkPath(url.pathname);
        if (chunkRoute) {
          const { platform, reference, kind } = chunkRoute;
          try {
            const chunk = await native.chunk(platform, reference, true);
            if (kind === "map") {
              send(
                response,
                200,
                "application/json",
                JSON.stringify(chunk.map),
              );
              return;
            }
            response.setHeader("SourceMap", chunkMapPath(platform, reference));
            send(
              response,
              200,
              "application/javascript",
              `${chunk.code}\n//# sourceMappingURL=${baseUrl}${chunkMapPath(
                platform,
                reference,
              )}\n`,
            );
          } catch (error) {
            server.config.logger.error(
              `flypath: chunk build failed for ${reference}\n${
                error instanceof Error ? (error.stack ?? error.message) : error
              }`,
            );
            send(response, 500, "text/plain", String(error));
          }
          return;
        }

        if (url.pathname.endsWith(".bundle")) {
          const platform = platformOf(url);
          if (!platform) {
            send(response, 400, "text/plain", "flypath: unknown platform");
            return;
          }
          const dev = url.searchParams.get("dev") !== "false";
          try {
            const built = await native.bundle(platform, dev);
            response.setHeader("X-Metro-Delta-ID", built.revisionId);
            response.setHeader(
              "SourceMap",
              `${url.pathname.replace(/\.bundle$/, ".map")}${url.search}`,
            );
            send(
              response,
              200,
              "application/javascript",
              `${built.code}\n//# sourceMappingURL=${url.pathname.replace(
                /\.bundle$/,
                ".map",
              )}${url.search}\n`,
            );
          } catch (error) {
            server.config.logger.error(
              `flypath: native bundle failed\n${
                error instanceof Error ? (error.stack ?? error.message) : error
              }`,
            );
            send(
              response,
              500,
              "application/javascript",
              `throw new Error(${JSON.stringify(String(error))});`,
            );
          }
          return;
        }

        if (url.pathname.endsWith(".map")) {
          const platform = platformOf(url);
          if (!platform) {
            next();
            return;
          }
          const built = await native.bundle(platform, true);
          send(response, 200, "application/json", JSON.stringify(built.map));
          return;
        }

        if (url.pathname === "/symbolicate") {
          try {
            const parsed = JSON.parse(await readBody(request)) as {
              stack: Array<Record<string, unknown>>;
            };
            const stack = await native.symbolicate(parsed.stack);
            send(response, 200, "application/json", JSON.stringify({ stack }));
          } catch (error) {
            send(
              response,
              500,
              "application/json",
              JSON.stringify({
                error: String(error),
              }),
            );
          }
          return;
        }

        next();
      });
    },
  };
}
