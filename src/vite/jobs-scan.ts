/**
 * Job discovery, and the `virtual:flypath/jobs` module it generates.
 *
 * Resolves jobs calls, set by `jobs.ts`. Walks the project, resolves every
 * `enqueue` and `cron` callee to a file plus an export name, and emits a module
 * that imports those files and calls `register({ "app/images.ts#resize": … })`
 * plus `configureJobs`.
 *
 * The server entry imports it, which is also how a production worker knows what
 * to load. A rename changes the id, so old rows fail loudly.
 */

import fs from "node:fs";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import type { JobsOptions } from "../jobs/config.ts";
import { distDir, EXTENSIONS, sources } from "../shared/paths.ts";
import type { Node } from "./eval.ts";
import { unwrap } from "./eval.ts";
import type { ModuleRecord, Parsed } from "./jobs.ts";
import {
  analyze,
  JobError,
  located,
  mayHaveSites,
  parse,
  sites,
} from "./jobs.ts";

const JOBS = "virtual:flypath/jobs";
const JOBS_ID = `\0${JOBS}`;

const CRON_CANDIDATES = ["app/crons.ts", "app/crons.tsx"];

type Reference = { source: string | null; name: string };

function importOf(
  record: ModuleRecord,
  local: string,
): { source: string; kind: string; name: string | null } | undefined {
  for (const entry of record.staticImports) {
    for (const specifier of entry.entries) {
      if (specifier.isType) continue;
      if (specifier.localName.value !== local) continue;
      return {
        source: entry.moduleRequest.value,
        kind: specifier.importName.kind,
        name: specifier.importName.name,
      };
    }
  }
  return undefined;
}

function exportNames(record: ModuleRecord): Set<string> {
  const out = new Set<string>();
  for (const entry of record.staticExports) {
    for (const specifier of entry.entries) {
      if (specifier.isType) continue;
      if (specifier.exportName.kind === "Default") out.add("default");
      if (specifier.exportName.name !== null) {
        out.add(specifier.exportName.name);
      }
    }
  }
  return out;
}

function exportedAs(record: ModuleRecord, local: string): string | undefined {
  for (const entry of record.staticExports) {
    for (const specifier of entry.entries) {
      if (specifier.isType) continue;
      if (specifier.moduleRequest !== null) continue;
      if (specifier.localName.name !== local) continue;
      if (specifier.exportName.kind === "Default") return "default";
      if (specifier.exportName.name !== null) return specifier.exportName.name;
    }
  }
  return undefined;
}

function moduleSource(node: Node): string | undefined {
  const call = unwrap(node);
  if (call["type"] !== "ImportExpression") return undefined;
  const source = unwrap(call["source"] as Node);
  if (source["type"] !== "Literal") return undefined;
  return typeof source["value"] === "string" ? source["value"] : undefined;
}

function reference(parsed: Parsed, callee: Node): Reference {
  const start = callee["start"] as number;
  const node = unwrap(callee);

  if (node["type"] === "Identifier") {
    const local = String(node["name"]);
    const imported = importOf(parsed.module, local);
    if (!imported) {
      const name = exportedAs(parsed.module, local);
      if (name === undefined) {
        throw new JobError(
          `flypath: "${local}" is not a job: a job must be a top-level export ` +
            "of a module, imported or exported where it is enqueued",
          start,
        );
      }
      return { source: null, name };
    }
    if (imported.kind === "NamespaceObject") {
      throw new JobError(
        `flypath: "${local}" is a module namespace, not a job`,
        start,
      );
    }
    return {
      source: imported.source,
      name: imported.kind === "Default" ? "default" : (imported.name ?? local),
    };
  }

  if (node["type"] === "MemberExpression" && node["computed"] !== true) {
    const property = node["property"] as Node;
    if (property["type"] !== "Identifier") {
      throw new JobError("flypath: a job must be a named export", start);
    }
    const name = String(property["name"]);
    const object = unwrap(node["object"] as Node);

    if (object["type"] === "Identifier") {
      const imported = importOf(parsed.module, String(object["name"]));
      if (imported?.kind === "NamespaceObject") {
        return { source: imported.source, name };
      }
      throw new JobError(
        `flypath: "${String(object["name"])}.${name}" is not a job: only a ` +
          "namespace import or a dynamic import can hold one",
        start,
      );
    }

    if (object["type"] === "AwaitExpression") {
      const source = moduleSource(object["argument"] as Node);
      if (source !== undefined) return { source, name };
    }
  }

  throw new JobError(
    "flypath: a job must be an identifier bound to an import or a top-level " +
      "export, or a member of a namespace or dynamic import",
    start,
  );
}

function directive(parsed: Parsed): string | undefined {
  for (const statement of (parsed.program["body"] as Node[]) ?? []) {
    if (statement["type"] !== "ExpressionStatement") return undefined;
    const expression = statement["expression"] as Node;
    if (expression["type"] !== "Literal") return undefined;
    if (typeof expression["value"] !== "string") return undefined;
    return expression["value"];
  }
  return undefined;
}

export type Discovery = {
  modules: Map<string, Set<string>>;
  watched: Set<string>;
};

type Resolver = {
  resolve: (source: string, importer: string) => Promise<{ id: string } | null>;
};

export async function discover(
  context: Resolver,
  root: string,
): Promise<Discovery> {
  const modules = new Map<string, Set<string>>();
  const watched = new Set<string>();
  const targets = new Map<string, Parsed | undefined>();

  const targetOf = (file: string): Parsed | undefined => {
    if (targets.has(file)) return targets.get(file);
    let parsed: Parsed | undefined;
    try {
      parsed = parse(file, fs.readFileSync(file, "utf8"));
    } catch {
      parsed = undefined;
    }
    targets.set(file, parsed);
    return parsed;
  };

  for (const file of sources(root, (name) =>
    EXTENSIONS.has(path.extname(name)),
  )) {
    let code;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!mayHaveSites(code)) continue;
    const parsed = parse(file, code);
    if (!parsed) continue;
    const found = sites(parsed);
    if (found.length === 0) continue;
    watched.add(file);

    for (const site of found) {
      let target: Reference;
      try {
        target = reference(parsed, analyze(site.thunk).callee);
      } catch (error) {
        if (error instanceof JobError) throw located(file, code, error);
        throw error;
      }

      let resolvedFile = file;
      if (target.source !== null) {
        const resolved = await context.resolve(target.source, file);
        if (!resolved) {
          throw new Error(
            `flypath: cannot resolve "${target.source}" from ${file}`,
          );
        }
        resolvedFile = resolved.id.split("?")[0] as string;
      }

      if (resolvedFile.includes("node_modules")) {
        throw new Error(
          `flypath: ${target.name} comes from node_modules; a job must be a ` +
            `module in the project (${file})`,
        );
      }

      const targetParsed = targetOf(resolvedFile);
      if (!targetParsed) {
        throw new Error(`flypath: cannot read the job module ${resolvedFile}`);
      }
      if (directive(targetParsed) === "use server") {
        throw new Error(
          `flypath: ${resolvedFile} is a "use server" module; its exports are ` +
            "public endpoints and cannot be jobs",
        );
      }
      if (!exportNames(targetParsed.module).has(target.name)) {
        throw new Error(
          `flypath: ${resolvedFile} does not export ${target.name}`,
        );
      }

      watched.add(resolvedFile);
      const names = modules.get(resolvedFile) ?? new Set<string>();
      names.add(target.name);
      modules.set(resolvedFile, names);
    }
  }

  return { modules, watched };
}

function cronsFile(root: string): string | undefined {
  for (const candidate of CRON_CANDIDATES) {
    const file = path.join(root, candidate);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

export function generate(
  root: string,
  discovery: Discovery,
  options: JobsOptions,
): string {
  const files = [...discovery.modules.keys()].toSorted();
  const lines: string[] = files.map(
    (file, index) =>
      `import * as m${String(index)} from ${JSON.stringify(file)};`,
  );

  const crons = cronsFile(root);
  lines.push(
    `import { register } from ${JSON.stringify(path.join(distDir, "jobs", "registry.js"))};`,
    `import { configureJobs } from ${JSON.stringify(path.join(distDir, "jobs", "config.js"))};`,
  );
  if (crons) lines.push(`import crons from ${JSON.stringify(crons)};`);

  const entries = files.flatMap((file, index) =>
    [...(discovery.modules.get(file) as Set<string>)].toSorted().map((name) => {
      const id = `${path.relative(root, file).split(path.sep).join("/")}#${name}`;
      return `  ${JSON.stringify(id)}: m${String(index)}[${JSON.stringify(name)}],`;
    }),
  );

  lines.push(
    `configureJobs(${JSON.stringify(options)});`,
    `register({\n${entries.join("\n")}\n}, ${crons ? "crons" : "[]"});`,
  );
  return lines.join("\n") + "\n";
}

export function jobsScan(options: JobsOptions): Plugin {
  let root = process.cwd();
  let server: ViteDevServer | undefined;
  let cached: string | undefined;
  let watched: Set<string> = new Set();

  const invalidate = (): void => {
    cached = undefined;
    watched = new Set();
    if (!server) return;
    for (const environment of Object.values(server.environments)) {
      const module = environment.moduleGraph.getModuleById(JOBS_ID);
      if (module) environment.moduleGraph.invalidateModule(module);
    }
    server.hot.send({ type: "full-reload" });
  };

  return {
    name: "flypath:jobs-scan",
    configResolved(config) {
      root = config.root;
    },
    configureServer(value) {
      server = value;
    },
    resolveId(source) {
      if (source === JOBS) return JOBS_ID;
      return undefined;
    },
    async load(id) {
      if (id !== JOBS_ID) return undefined;
      if (cached === undefined) {
        const discovery = await discover(this, root);
        watched = discovery.watched;
        const crons = cronsFile(root);
        if (crons) watched.add(crons);
        cached = generate(root, discovery, options);
      }
      for (const file of watched) this.addWatchFile(file);
      return cached;
    },
    watchChange(id, change) {
      const file = path.resolve(id);
      if (watched.has(file)) {
        invalidate();
        return;
      }
      if (change.event === "update") return;
      if (!EXTENSIONS.has(path.extname(file))) return;
      if (!file.startsWith(root)) return;
      invalidate();
    },
  };
}
