import * as devMiddleware from "@react-native/dev-middleware";
import type { WebSocketServer } from "ws";

const createDevMiddleware = (devMiddleware as { createDevMiddleware: unknown })
  .createDevMiddleware as (options: Record<string, unknown>) => {
  middleware: (
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void,
  ) => void;
  websocketEndpoints: Record<string, WebSocketServer>;
};
import type { ViteDevServer } from "vite";

import type { Upgrade } from "./metro-sockets.ts";

export function attachDevMiddleware(
  server: ViteDevServer,
  baseUrl: string,
): Map<string, Upgrade> {
  const { middleware, websocketEndpoints } = createDevMiddleware({
    serverBaseUrl: baseUrl,
    logger: {
      info: (...args: unknown[]) => server.config.logger.info(args.join(" ")),
      warn: (...args: unknown[]) => server.config.logger.warn(args.join(" ")),
      error: (...args: unknown[]) => server.config.logger.error(args.join(" ")),
    },
    unstable_experiments: {
      enableNetworkInspector: true,
    },
  });

  server.middlewares.use(middleware as never);

  const upgrades = new Map<string, Upgrade>();
  for (const [path, wss] of Object.entries(websocketEndpoints)) {
    upgrades.set(path, (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit("connection", client, request);
      });
    });
  }
  return upgrades;
}
