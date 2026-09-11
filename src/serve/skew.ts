import fs from "node:fs";
import path from "node:path";

import { BASE_HEADER, BINARY_HEADER, BUILD_HEADER } from "../shared/headers.ts";

type ChunkManifest = {
  baseId: string;
  build: string;
  chunks: Record<string, string>;
};

const cache = new Map<string, ChunkManifest | undefined>();

function readChunkManifest(
  clientDir: string,
  platform: string,
): ChunkManifest | undefined {
  const key = `${clientDir} ${platform}`;
  if (cache.has(key)) return cache.get(key);
  let manifest: ChunkManifest | undefined;
  try {
    manifest = JSON.parse(
      fs.readFileSync(
        path.join(clientDir, "native", `${platform}.json`),
        "utf8",
      ),
    ) as ChunkManifest;
  } catch {
    manifest = undefined;
  }
  cache.set(key, manifest);
  return manifest;
}

export function forgetChunkManifests(): void {
  cache.clear();
}

const NATIVE = /^\/(?:chunk\/([^/]+)\/|native\/([^/]+)\.json$)/;

export function nativeTarget(pathname: string): string | undefined {
  const match = NATIVE.exec(pathname);
  if (!match) return undefined;
  return match[1] ?? match[2];
}

export function ageOf(build: string): string {
  return build.split("-")[0] ?? build;
}

export type SkewOptions = {
  clientDir: string | undefined;
  minimumBuild: string | undefined;
};

export function skewResponse(
  request: Request,
  options: SkewOptions,
): Response | undefined {
  const binary = request.headers.get(BINARY_HEADER);
  const minimum = options.minimumBuild;
  if (
    minimum !== undefined &&
    binary !== null &&
    binary !== "" &&
    ageOf(binary) < ageOf(minimum)
  ) {
    return new Response(
      `This server requires a build of the app from ${minimum} or later`,
      {
        status: 426,
        headers: {
          "content-type": "text/plain;charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  const platform = nativeTarget(new URL(request.url).pathname);
  if (platform === undefined || options.clientDir === undefined) {
    return undefined;
  }

  const declared = request.headers.get(BASE_HEADER);
  if (declared === null || declared === "") return undefined;

  const manifest = readChunkManifest(options.clientDir, platform);
  if (!manifest || manifest.baseId === declared) return undefined;

  return new Response(
    `This app was built against base bundle ${declared}, and the ` +
      `server is serving ${manifest.baseId}; chunks built for one base cannot ` +
      "be evaluated against the other",
    {
      status: 409,
      headers: {
        "content-type": "text/plain;charset=utf-8",
        "cache-control": "no-store",
        [BUILD_HEADER]: manifest.build,
      },
    },
  );
}

const FLYPATH_HEADER = /^x-flypath-/i;

export function withoutFlypathHeaders(request: Request): Request {
  const headers = new Headers();
  let stripped = false;
  for (const [key, value] of request.headers) {
    if (FLYPATH_HEADER.test(key)) {
      stripped = true;
      continue;
    }
    headers.append(key, value);
  }
  if (!stripped) return request;
  return new Request(request.url, { method: request.method, headers });
}
