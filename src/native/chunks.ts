import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { FlypathError } from "../shared/errors.ts";
import { distDir, EXTENSIONS, sources } from "../shared/paths.ts";
import { hash } from "../styles/hash.ts";
import type { NativeBundler, NativeSourceMap } from "../vite/bundler.ts";
import type { NativePlatform } from "../vite/native-env.ts";

const DIRECTIVE =
  /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use (?:client|native)\1/;

export function referenceKey(relative: string): string {
  return crypto
    .createHash("sha256")
    .update(relative)
    .digest("hex")
    .slice(0, 12);
}

export function toRelativeId(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export type ClientReference = {
  key: string;
  file: string;
  relative: string;
};

function scan(
  root: string,
  dir: string,
  out: Map<string, ClientReference>,
): void {
  const files = sources(dir, (name) =>
    EXTENSIONS.has(path.extname(name).toLowerCase()),
  );
  for (const file of files) {
    let code: string;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!DIRECTIVE.test(code)) continue;
    const relative = toRelativeId(root, file);
    out.set(referenceKey(relative), {
      key: referenceKey(relative),
      file,
      relative,
    });
  }
}

function discoverReferences(root: string): Map<string, ClientReference> {
  const out = new Map<string, ClientReference>();
  scan(root, root, out);
  scan(root, distDir, out);
  return out;
}

const KEY = /"([0-9a-f]{12})":\s*\{/g;

export function manifestKeys(rscDir: string): string[] {
  const file = path.join(rscDir, "__vite_rsc_assets_manifest.js");
  let code: string;
  try {
    code = fs.readFileSync(file, "utf8");
  } catch {
    throw new FlypathError(`${file} is missing`, {
      hint: "The server build has to run before the native chunks",
    });
  }
  const start = code.indexOf('"clientReferenceDeps"');
  if (start === -1) return [];
  const body = code.slice(start);
  const end = body.indexOf("\n  },");
  const section = end === -1 ? body : body.slice(0, end);
  return [...section.matchAll(KEY)].map((match) => match[1] as string);
}

export function resolveReferences(
  root: string,
  rscDir: string,
): ClientReference[] {
  const found = discoverReferences(root);
  const out: ClientReference[] = [];
  const missing: string[] = [];

  for (const key of manifestKeys(rscDir)) {
    const reference = found.get(key);
    if (!reference) {
      missing.push(key);
      continue;
    }
    out.push(reference);
  }

  if (missing.length > 0) {
    throw new FlypathError(
      "The server build references client modules the native build cannot find",
      {
        hint:
          "Reference keys hash the path relative to the project root, so " +
          "the two builds disagree about where a module lives. Rebuild both",
        details: missing,
      },
    );
  }

  return out;
}

export type ChunkBuild = {
  key: string;
  entry: string;
  file: string;
  moduleId: number;
  code: string;
  map: NativeSourceMap;
  empty: boolean;
};

export type ChunkSet = {
  chunks: ChunkBuild[];
  seeded: Record<string, number>;
  entries: string[];
};

export async function buildChunks(
  bundler: NativeBundler,
  references: readonly ClientReference[],
): Promise<ChunkSet> {
  const chunks: ChunkBuild[] = [];
  const seeded: Record<string, number> = {};
  const entries: string[] = [];

  for (const reference of references) {
    const built = await bundler.buildChunk(reference.file, false);
    const registration = `global.__FLYPATH__.chunks[${JSON.stringify(
      reference.key,
    )}] = ${String(built.moduleId)};\n`;
    const code = `${built.code}${registration}`;
    const file = `${reference.key}-${hash(code)}.bundle`;

    chunks.push({
      key: reference.key,
      entry: reference.file,
      file,
      moduleId: built.moduleId,
      code,
      map: built.map,
      empty: built.moduleIds.length === 0,
    });
    seeded[file] = built.moduleId;
    entries.push(reference.file);
  }

  return { chunks, seeded, entries };
}

export type NativeChunkManifest = {
  baseId: string;
  build: string;
  chunks: Record<string, string>;
};

export function writeChunks(
  clientDir: string,
  platform: NativePlatform,
  chunks: readonly ChunkBuild[],
): void {
  const dir = path.join(clientDir, "chunk", platform);
  fs.mkdirSync(dir, { recursive: true });
  for (const chunk of chunks) {
    fs.writeFileSync(path.join(dir, chunk.file), chunk.code);
    fs.writeFileSync(
      path.join(dir, `${chunk.file}.map`),
      JSON.stringify(chunk.map),
    );
  }
}

export function writeChunkManifest(
  clientDir: string,
  platform: NativePlatform,
  manifest: NativeChunkManifest,
): string {
  const dir = path.join(clientDir, "native");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${platform}.json`);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export function chunkManifest(
  baseId: string,
  build: string,
  chunks: readonly ChunkBuild[],
): NativeChunkManifest {
  return {
    baseId,
    build,
    chunks: Object.fromEntries(chunks.map((chunk) => [chunk.key, chunk.file])),
  };
}
