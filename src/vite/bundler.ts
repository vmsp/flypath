import fs from "node:fs";
import path from "node:path";

import { addMapping, GenMapping, toEncodedMap } from "@jridgewell/gen-mapping";
import { eachMapping, TraceMap } from "@jridgewell/trace-mapping";
import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { DevEnvironment } from "vite";

import { nativePrelude } from "../runtime/native-prelude.ts";
import { hash } from "../styles/hash.ts";

export type NativeModule = {
  id: string;
  moduleId: number;
  url: string;
  code: string;
  map: unknown;
  isEsm: boolean;
  isCjs: boolean;
  deps: number[];
};

export type NativeSourceMap = {
  version: number;
  sources: (string | null)[];
  names: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
};

export type NativeBundle = {
  code: string;
  map: NativeSourceMap;
  revisionId: string;
  moduleIds: number[];
};

export type NativeChunk = {
  code: string;
  map: NativeSourceMap;
  moduleId: number;
  moduleIds: number[];
};

export type BuildOptions = {
  entries: string[];
  platform: string;
  dev: boolean;
  serverUrl: string;
  manifestHash: string;
};

const WRAPPER_HEADER_LINES = 11;

function numericId(key: string): number {
  return Number.parseInt(hash(key).slice(-8), 36) % 0x7fffffff;
}

function decodeViteUrl(url: string): string | undefined {
  if (url.startsWith("/@id/")) {
    const value = url.slice("/@id/".length);
    return value.startsWith("__x00__") ? `\0${value.slice(7)}` : value;
  }
  if (url.startsWith("/@fs/")) return url.slice("/@fs".length);
  return undefined;
}

const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\1/;

function assertServerProxy(id: string, code: string): void {
  if (id.startsWith("\0") || !/\.[jt]sx?$/.test(id)) return;
  if (code.includes("createServerReference")) return;
  let source: string;
  try {
    source = fs.readFileSync(id, "utf8");
  } catch {
    return;
  }
  if (!USE_SERVER.test(source)) return;
  throw new Error(
    `flypath: "use server" module reached the native bundle un-proxied — ` +
      `its body would ship to the device: ${id}`,
  );
}

const REQUIRE_RE = /\brequire\s*\(/;

function isEsmOutput(code: string): boolean {
  return (
    code.includes("__vite_ssr_exports__") ||
    code.includes("__vite_ssr_import__") ||
    code.includes("__vite_ssr_exportAll__") ||
    code.includes("__vite_ssr_exportName__")
  );
}

type RequireNode = { start: number; end: number; value: string };

function findRequires(id: string, code: string): RequireNode[] {
  const found: RequireNode[] = [];
  if (!REQUIRE_RE.test(code)) return found;

  const { program, errors } = parseSync(id, code);
  if (errors.length > 0) return found;

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const record = node as Record<string, unknown>;
    if (record["type"] === "CallExpression") {
      const callee = record["callee"] as { name?: string } | undefined;
      const args = record["arguments"] as
        | Array<{
            type?: string;
            value?: unknown;
            start?: number;
            end?: number;
          }>
        | undefined;
      const first = args?.[0];
      if (
        callee?.name === "require" &&
        args?.length === 1 &&
        first?.type === "Literal" &&
        typeof first.value === "string"
      ) {
        found.push({
          start: first.start as number,
          end: first.end as number,
          value: first.value,
        });
      }
    }
    for (const key of Object.keys(record)) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(record[key]);
    }
  };

  visit(program);
  return found;
}

const HOISTED_RE = /^const (__cjs_to_esm_hoist_\d+) = (.*);$/gm;

function lazyHoistedRequires(code: string): string {
  if (!code.includes("__cjs_to_esm_hoist_")) return code;

  const initializers: string[] = [];
  const names: string[] = [];

  const stripped = code.replaceAll(
    HOISTED_RE,
    (_match, name: string, expr: string) => {
      names.push(name);
      initializers.push(
        `var ${name}$v, ${name}$i;\nfunction ${name}$f() { if (!${name}$i) { ${name}$i = 1; ${name}$v = ${expr}; } return ${name}$v; }`,
      );
      return "";
    },
  );

  if (names.length === 0) return code;

  let output = stripped;
  for (const name of names) {
    output = output.replaceAll(
      new RegExp(`\\b${name}\\b(?!\\$)`, "g"),
      `${name}$f()`,
    );
  }

  return `${initializers.join("\n")}\n${output}`;
}

export function wrapModule(
  mod: NativeModule,
  verbose: boolean,
  inverseDependencies?: Record<number, number[]>,
): string {
  let tail = `, ${JSON.stringify(mod.deps)}`;
  if (verbose) tail += `, ${JSON.stringify(mod.id)}`;
  if (inverseDependencies) {
    tail += `, ${JSON.stringify(inverseDependencies)}`;
  }

  return `__d(function (global, require, importDefault, importAll, $$module, $$exports, dependencyMap) {
"use strict";
var __vite_ssr_exports__ = $$exports;
var __vite_ssr_import__ = global.__flypathNamespace;
var __vite_ssr_sync_import__ = require;
var __flypathLazy = global.__flypathLazy;
var __vite_ssr_import_meta__ = { url: global.__FLYPATH__.serverUrl + ${JSON.stringify(mod.url)}, env: { MODE: global.process.env.NODE_ENV, DEV: global.__DEV__, PROD: !global.__DEV__, SSR: false }, hot: undefined };
var __vite_ssr_dynamic_import__ = function (id) { try { return Promise.resolve(global.__flypathNamespace(id)); } catch (e) { return Promise.reject(e); } };
var __vite_ssr_exportAll__ = function (source) { for (var key in source) { if (key === "default") continue; (function (k) { Object.defineProperty($$exports, k, { enumerable: true, configurable: true, get: function () { return source[k]; } }); })(key); } };
var __vite_ssr_exportName__ = function (name, getter) { Object.defineProperty($$exports, name, { enumerable: true, configurable: true, get: getter }); };
${mod.isEsm && !mod.isCjs ? `$$exports.__esModule = true;` : ""}
${mod.code}
${mod.isCjs ? `$$module.exports = module.exports;` : ""}
}, ${mod.moduleId}${tail});
`;
}

export class NativeBundler {
  #environment: DevEnvironment;
  #root: string;
  #modules = new Map<string, NativeModule>();
  #ids = new Map<string, number>();
  #urlToId = new Map<string, string>();
  #pending = new Map<string, Promise<void>>();
  #idToModule = new Map<number, string>();
  #base = new Set<string>();
  #revision = 0;

  constructor(environment: DevEnvironment, root: string) {
    this.#environment = environment;
    this.#root = root;
  }

  get modules(): Map<string, NativeModule> {
    return this.#modules;
  }

  moduleId(id: string): number {
    const cached = this.#ids.get(id);
    if (cached !== undefined) return cached;
    const value = numericId(this.moduleKey(id));
    const clash = this.#idToModule.get(value);
    if (clash !== undefined && clash !== id) {
      throw new Error(
        `flypath: native module id collision between ${clash} and ${id}`,
      );
    }
    this.#ids.set(id, value);
    this.#idToModule.set(value, id);
    return value;
  }

  moduleKey(id: string): string {
    if (id.startsWith(this.#root + path.sep)) {
      return path.relative(this.#root, id).replaceAll(path.sep, "/");
    }
    return id.replaceAll(path.sep, "/");
  }

  isChunkModule(id: string): boolean {
    return this.#modules.has(id) && !this.#base.has(id);
  }

  moduleById(moduleId: number): NativeModule | undefined {
    for (const mod of this.#modules.values()) {
      if (mod.moduleId === moduleId) return mod;
    }
    return undefined;
  }

  invalidate(ids: Iterable<string>): NativeModule[] {
    const removed: NativeModule[] = [];
    for (const id of ids) {
      const mod = this.#modules.get(id);
      if (!mod) continue;
      removed.push(mod);
      this.#modules.delete(id);
      this.#pending.delete(id);
      this.#invalidateGraph(id);
    }
    return removed;
  }

  #invalidateGraph(id: string): void {
    const graph = this.#environment.moduleGraph;
    const nodes = graph.getModulesByFile(id);
    if (!nodes) return;
    for (const node of nodes) graph.invalidateModule(node);
  }

  inverseDependencies(moduleId: number): Record<number, number[]> {
    const inverse: Record<number, number[]> = {};
    const seen = new Set<number>();
    const queue = [moduleId];

    while (queue.length > 0) {
      const current = queue.pop() as number;
      if (seen.has(current)) continue;
      seen.add(current);
      const parents: number[] = [];
      for (const mod of this.#modules.values()) {
        if (mod.deps.includes(current)) {
          parents.push(mod.moduleId);
          queue.push(mod.moduleId);
        }
      }
      inverse[current] = parents;
    }

    return inverse;
  }

  async #resolve(source: string, importer?: string): Promise<string | null> {
    const resolved = await this.#environment.pluginContainer.resolveId(
      source,
      importer,
    );
    return resolved?.id ?? null;
  }

  urlFor(id: string): string {
    if (id.startsWith("\0")) return id;
    if (id.startsWith("/@")) return id;
    if (!path.isAbsolute(id)) return `/@id/${id}`;
    if (id.startsWith(this.#root + path.sep)) {
      return `/${path.relative(this.#root, id).replaceAll(path.sep, "/")}`;
    }
    return `/@fs${id}`;
  }

  async load(id: string): Promise<void> {
    if (this.#modules.has(id)) return;
    const existing = this.#pending.get(id);
    if (existing) return existing;
    const task = this.#transform(id).finally(() => {
      this.#pending.delete(id);
    });
    this.#pending.set(id, task);
    return task;
  }

  async transformOne(id: string): Promise<NativeModule> {
    await this.#transform(id);
    const mod = this.#modules.get(id);
    if (!mod) throw new Error(`flypath: failed to build ${id}`);
    return mod;
  }

  async #transform(id: string): Promise<void> {
    const url = this.urlFor(id);
    const result = await this.#environment.transformRequest(url);
    if (!result) throw new Error(`flypath: failed to transform ${id}`);

    const deps = new Set<string>();
    let code = lazyHoistedRequires(
      result.code
        .replaceAll("await __vite_ssr_import__(", "__vite_ssr_import__(")
        .replaceAll(
          "__cjs_interop__(await __vite_ssr_dynamic_import__(",
          "__cjs_interop__(__vite_ssr_sync_import__(",
        ),
    );

    const rawDeps = [...(result.deps ?? []), ...(result.dynamicDeps ?? [])];
    for (const dep of rawDeps) {
      const depId =
        this.#urlToId.get(dep) ??
        decodeViteUrl(dep) ??
        (await this.#resolve(dep, id)) ??
        dep;
      this.#urlToId.set(dep, depId);
      deps.add(depId);
      const numeric = this.moduleId(depId);
      code = code.replaceAll(
        `__vite_ssr_import__(${JSON.stringify(dep)}`,
        `__vite_ssr_import__(${numeric}`,
      );
      code = code.replaceAll(
        `__vite_ssr_dynamic_import__(${JSON.stringify(dep)}`,
        `__vite_ssr_dynamic_import__(${numeric}`,
      );
      code = code.replaceAll(
        `__vite_ssr_sync_import__(${JSON.stringify(dep)}`,
        `__vite_ssr_sync_import__(${numeric}`,
      );
    }

    code = code.replaceAll(
      /const (__vite_ssr_import_\d+__) = __vite_ssr_import__\((\d+)[^;]*\);/g,
      "const $1 = __flypathLazy($2);",
    );

    const requires = findRequires(id, code);
    if (requires.length > 0) {
      const magic = new MagicString(code);
      for (const node of requires) {
        const depId = await this.#resolve(node.value, id);
        if (!depId) continue;
        deps.add(depId);
        magic.overwrite(node.start, node.end, String(this.moduleId(depId)));
      }
      code = magic.toString();
    }

    assertServerProxy(id, code);

    this.#modules.set(id, {
      id,
      moduleId: this.moduleId(id),
      url,
      code,
      map: result.map,
      isEsm: isEsmOutput(code),
      isCjs: code.includes("const __cjs_module_runner_transform = true;"),
      deps: [...deps].map((dep) => this.moduleId(dep)),
    });

    await Promise.all([...deps].map((dep) => this.load(dep)));
  }

  async resolveEntry(entry: string): Promise<string> {
    const id = path.isAbsolute(entry)
      ? entry
      : await this.#resolve(entry, path.join(this.#root, "index.js"));
    if (!id) throw new Error(`flypath: cannot resolve native entry ${entry}`);
    return id;
  }

  #closure(entryIds: string[]): NativeModule[] {
    const seen = new Set<string>();
    const out: NativeModule[] = [];
    const byId = new Map<number, NativeModule>();
    for (const mod of this.#modules.values()) byId.set(mod.moduleId, mod);

    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const mod = this.#modules.get(id);
      if (!mod) return;
      out.push(mod);
      for (const dep of mod.deps) {
        const next = byId.get(dep);
        if (next) visit(next.id);
      }
    };

    for (const id of entryIds) visit(id);
    return out;
  }

  async build(options: BuildOptions): Promise<NativeBundle> {
    const entryIds: string[] = [];
    for (const entry of options.entries) {
      const id = await this.resolveEntry(entry);
      entryIds.push(id);
      await this.load(id);
    }

    const prelude = nativePrelude({
      root: this.#root,
      platform: options.platform,
      dev: options.dev,
      serverUrl: options.serverUrl,
      manifestHash: options.manifestHash,
    });

    const modules = this.#closure(entryIds);
    this.#base = new Set(modules.map((mod) => mod.id));

    const generator = new GenMapping();
    const chunks: string[] = [prelude];
    let line = countLines(prelude);

    for (const mod of modules) {
      const wrapped = wrapModule(mod, options.dev);
      chunks.push(wrapped);
      addModuleMappings(generator, mod, line + WRAPPER_HEADER_LINES);
      line += countLines(wrapped);
    }

    for (const id of entryIds) {
      chunks.push(`__r(${this.moduleId(id)});\n`);
    }

    return {
      code: chunks.join(""),
      map: toEncodedMap(generator) as NativeSourceMap,
      revisionId: String(this.#revision++),
      moduleIds: entryIds.map((id) => this.moduleId(id)),
    };
  }

  get base(): ReadonlySet<string> {
    return this.#base;
  }

  async buildChunk(entry: string, dev: boolean): Promise<NativeChunk> {
    const id = await this.resolveEntry(entry);
    await this.load(id);

    const modules = this.#closure([id]).filter(
      (mod) => !this.#base.has(mod.id),
    );

    const generator = new GenMapping();
    const parts: string[] = [];
    let line = 0;

    for (const mod of modules) {
      const wrapped = wrapModule(mod, dev);
      parts.push(wrapped);
      addModuleMappings(generator, mod, line + WRAPPER_HEADER_LINES);
      line += countLines(wrapped);
    }

    return {
      code: parts.join(""),
      map: toEncodedMap(generator) as NativeSourceMap,
      moduleId: this.moduleId(id),
      moduleIds: modules.map((mod) => mod.moduleId),
    };
  }
}

function countLines(code: string): number {
  let count = 0;
  for (let index = 0; index < code.length; index++) {
    if (code[index] === "\n") count++;
  }
  return count;
}

function addModuleMappings(
  generator: GenMapping,
  mod: NativeModule,
  lineOffset: number,
): void {
  const raw = mod.map as { mappings?: string } | null;
  if (!raw?.mappings) return;

  const trace = new TraceMap(raw as never);
  eachMapping(trace, (mapping) => {
    const source = mapping.source;
    const originalLine = mapping.originalLine;
    const originalColumn = mapping.originalColumn;
    if (
      source === null ||
      source === undefined ||
      originalLine === null ||
      originalLine === undefined ||
      originalColumn === null ||
      originalColumn === undefined
    ) {
      return;
    }
    addMapping(generator, {
      generated: {
        line: mapping.generatedLine + lineOffset,
        column: mapping.generatedColumn,
      },
      original: { line: originalLine, column: originalColumn },
      source: source.startsWith("/") ? source : mod.id,
      name: typeof mapping.name === "string" ? mapping.name : "",
    });
  });
}
