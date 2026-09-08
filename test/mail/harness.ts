import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export type Mailpit = {
  smtpUrl: string;
  api: string;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  latest: () => Promise<MailpitMessage>;
  raw: () => Promise<string>;
  htmlCheck: () => Promise<HtmlCheck>;
};

type MailpitAddress = { Name: string; Address: string };

type MailpitMessage = {
  ID: string;
  Subject: string;
  From: MailpitAddress | null;
  To: MailpitAddress[];
  Cc: MailpitAddress[];
  Bcc: MailpitAddress[];
  HTML: string;
  Text: string;
  Inline: { ContentID: string; ContentType: string; FileName: string }[];
  Attachments: { ContentType: string; FileName: string }[];
};

type HtmlCheck = {
  Total: {
    Tests: number;
    Nodes: number;
    Supported: number;
    Partial: number;
    Unsupported: number;
  };
  Warnings: { Slug: string; Title: string; Score: { Unsupported: number } }[];
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function ready(api: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${api}/api/v1/info`);
      if (response.ok) return true;
    } catch {}
    await delay(50);
  }
  return false;
}

export async function mailpit(): Promise<Mailpit | undefined> {
  const smtpPort = await freePort();
  const httpPort = await freePort();
  const api = `http://127.0.0.1:${String(httpPort)}`;

  let child: ChildProcess;
  try {
    child = spawn(
      "mailpit",
      [
        "--smtp",
        `127.0.0.1:${String(smtpPort)}`,
        "--listen",
        `127.0.0.1:${String(httpPort)}`,
        "--database",
        "",
        "--quiet",
        "--disable-version-check",
      ],
      { stdio: "ignore" },
    );
  } catch {
    return undefined;
  }

  let failed = false;
  child.on("error", () => {
    failed = true;
  });

  if (failed || !(await ready(api))) {
    child.kill();
    return undefined;
  }

  const json = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${api}${path}`);
    if (!response.ok) {
      throw new Error(`mailpit ${path} answered ${String(response.status)}`);
    }
    return (await response.json()) as T;
  };

  return {
    api,
    smtpUrl: `smtp://127.0.0.1:${String(smtpPort)}`,
    stop: () =>
      new Promise<void>((resolve) => {
        child.on("exit", () => {
          resolve();
        });
        child.kill();
      }),
    clear: async () => {
      await fetch(`${api}/api/v1/messages`, { method: "DELETE" });
    },
    latest: () => json<MailpitMessage>("/api/v1/message/latest"),
    raw: async () => {
      const response = await fetch(`${api}/api/v1/message/latest/raw`);
      return response.text();
    },
    htmlCheck: () => json<HtmlCheck>("/api/v1/message/latest/html-check"),
  };
}

export function hasMailpit(): boolean {
  const probe = spawnSync("mailpit", ["version"], { stdio: "ignore" });
  return probe.status === 0;
}
