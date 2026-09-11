import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { DeviceEvent } from "../shared/events.ts";
import { report } from "../shared/events.ts";

export type Upgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

class SocketEndpoint {
  protected wss: WebSocketServer;

  protected clients: Set<WebSocket> = new Set<WebSocket>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket, request: IncomingMessage) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
      this.onConnection(socket, request);
    });
  }

  protected onConnection(_socket: WebSocket, _request: IncomingMessage): void {}

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

function platformIn(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return (
      new URL(url, "http://localhost").searchParams.get("platform") ?? undefined
    );
  } catch {
    return undefined;
  }
}

function level(value: string | undefined): DeviceEvent["level"] | undefined {
  switch (value) {
    case "warn":
      return "warn";
    case "error":
      return "error";
    case "debug":
    case "trace":
      return "debug";
    case "groupEnd":
      return undefined;
    default:
      return "log";
  }
}

export class HotSocket extends SocketEndpoint {
  protected override onConnection(
    socket: WebSocket,
    request: IncomingMessage,
  ): void {
    let platform = platformIn(request.url);

    socket.on("message", (raw) => {
      let data: {
        type?: string;
        level?: string;
        data?: unknown[];
        entryPoints?: unknown[];
      };
      try {
        data = JSON.parse(String(raw)) as typeof data;
      } catch {
        return;
      }

      if (data.type === "register-entrypoints") {
        platform ??= (data.entryPoints ?? [])
          .map((entry) => platformIn(String(entry)))
          .find((entry) => entry !== undefined);
        socket.send(JSON.stringify({ type: "bundle-registered" }));
        return;
      }

      if (data.type === "log" && Array.isArray(data.data)) {
        const kind = level(data.level);
        if (kind === undefined) return;
        report({
          kind: "device",
          platform: platform ?? "native",
          level: kind,
          text: data.data
            .map((entry) =>
              typeof entry === "string" ? entry : JSON.stringify(entry),
            )
            .join(" "),
        });
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
