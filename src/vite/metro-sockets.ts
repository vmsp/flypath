import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { Logger } from "vite";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

export type Upgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export class SocketEndpoint {
  protected wss: WebSocketServer;

  protected clients: Set<WebSocket> = new Set<WebSocket>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
      this.onConnection(socket);
    });
  }

  protected onConnection(_socket: WebSocket): void {}

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (client) => {
      this.wss.emit("connection", client, request);
    });
  }

  send(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export class MessageSocket extends SocketEndpoint {
  broadcast(method: string, params?: Record<string, unknown>): void {
    this.send({ version: 2, method, params });
  }

  reload(): void {
    this.broadcast("reload");
  }

  devMenu(): void {
    this.broadcast("devMenu");
  }
}

export class FlypathSocket extends SocketEndpoint {
  rscUpdate(): void {
    this.send({ type: "rsc-update" });
  }
}

export type HotUpdate = {
  revisionId: string;
  isInitialUpdate: boolean;
  added: Array<{ module: [number, string]; sourceURL: string }>;
  modified: Array<{ module: [number, string]; sourceURL: string }>;
  deleted: number[];
};

export class HotSocket extends SocketEndpoint {
  #logger: Logger;

  constructor(logger: Logger) {
    super();
    this.#logger = logger;
  }

  protected override onConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      let data: { type?: string; level?: string; data?: unknown[] };
      try {
        data = JSON.parse(String(raw)) as typeof data;
      } catch {
        return;
      }

      if (data.type === "register-entrypoints") {
        socket.send(JSON.stringify({ type: "bundle-registered" }));
        return;
      }

      if (data.type === "log" && Array.isArray(data.data)) {
        this.#logger.info(
          `[native:${data.level ?? "log"}] ${data.data.join(" ")}`,
        );
      }
    });
  }

  updateStart(isInitialUpdate = false): void {
    this.send({ type: "update-start", body: { isInitialUpdate } });
  }

  update(body: HotUpdate): void {
    this.send({ type: "update", body });
  }

  updateDone(): void {
    this.send({ type: "update-done" });
  }

  error(message: string): void {
    this.send({
      type: "error",
      body: { type: "TransformError", message, errors: [] },
    });
  }
}
