import fs from "node:fs";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import type { AtomicRule } from "../styles/atomic.ts";
import { RESET } from "../styles/defaults.ts";
import { extractStyles } from "./extract.ts";
import type { Compiled, Resolver } from "./tokens.ts";
import { compileTokens, diagnostic } from "./tokens.ts";

const STYLESHEET = "virtual:flypath/styles.css";
const STYLESHEET_ID = `\0${STYLESHEET}`;

const SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "android",
  "ios",
]);

function scan(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      scan(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".css.ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function clean(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

const IMPORTS_CSS = /import\s*\{[^}]*\bcss\b[^}]*\}\s*from\s*["']flypath["']/;

export function styles(distDir: string): Plugin[] {
  const registryPath = path.join(distDir, "styles", "registry.js");
  const modules = new Map<string, Compiled>();
  const atomic = new Map<string, string>();

  let root = process.cwd();
  let server: ViteDevServer | undefined;
  let scanned = false;

  const relative = (file: string) =>
    path.relative(root, file).split(path.sep).join("/");

  const compile = (file: string): Compiled | undefined => {
    const cached = modules.get(file);
    if (cached) return cached;
    let code: string;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
    const compiled = compileTokens(
      file,
      code,
      relative(file),
      resolverFor(file),
    );
    modules.set(file, compiled);
    return compiled;
  };

  const resolverFor =
    (importer: string): Resolver =>
    (source) => {
      if (!source.startsWith(".")) return undefined;
      const file = path.resolve(path.dirname(importer), source);
      return compile(file);
    };

  const ensureScan = () => {
    if (scanned) return;
    scanned = true;
    const files: string[] = [];
    scan(root, files);
    for (const file of files) {
      if (modules.has(file)) continue;
      try {
        compile(file);
      } catch (error) {
        throw diagnostic(error, relative(file));
      }
    }
  };

  const stylesheet = (): string => {
    ensureScan();
    const parts = [RESET];
    for (const file of [...modules.keys()].sort()) {
      const compiled = modules.get(file);
      if (compiled && compiled.css !== "") parts.push(compiled.css);
    }
    for (const className of [...atomic.keys()].sort()) {
      parts.push(atomic.get(className) as string);
    }
    return `${parts.join("\n\n")}\n`;
  };

  const invalidate = () => {
    if (!server) return;
    for (const name of ["client", "ssr", "rsc"]) {
      const environment = server.environments[name];
      if (!environment) continue;
      for (const id of [STYLESHEET_ID, `${STYLESHEET_ID}?direct`]) {
        const module = environment.moduleGraph.getModuleById(id);
        if (module) environment.moduleGraph.invalidateModule(module);
      }
    }
    const url = `/@id/__x00__${STYLESHEET}`;
    server.hot.send({
      type: "update",
      updates: [
        {
          type: "css-update",
          path: url,
          acceptedPath: url,
          timestamp: Date.now(),
        },
      ],
    });
  };

  const addRules = (rules: AtomicRule[]): void => {
    let changed = false;
    for (const rule of rules) {
      if (atomic.get(rule.className) === rule.css) continue;
      atomic.set(rule.className, rule.css);
      changed = true;
    }
    if (changed) invalidate();
  };

  return [
    {
      name: "flypath:styles",
      enforce: "pre",
      configResolved(config) {
        root = config.root;
      },
      configureServer(value) {
        server = value;
      },
      buildStart() {
        ensureScan();
      },
      watchChange(id, change) {
        const file = clean(id);
        if (!file.endsWith(".css.ts")) return;
        const previous = modules.get(file);
        modules.delete(file);
        if (change.event === "delete") {
          if (previous) invalidate();
          return;
        }
        try {
          const compiled = compile(file);
          if (previous?.css !== compiled?.css) invalidate();
        } catch {
          return;
        }
      },
      resolveId(source) {
        const base = clean(source);
        if (base === STYLESHEET) {
          return `${STYLESHEET_ID}${source.slice(base.length)}`;
        }
        return undefined;
      },
      load(id) {
        if (clean(id) !== STYLESHEET_ID) return undefined;
        return stylesheet();
      },
      transform(code, id) {
        const file = clean(id);
        if (file.includes("/node_modules/")) return undefined;

        if (file.endsWith(".css.ts")) {
          const previous = modules.get(file);
          modules.delete(file);
          let compiled: Compiled;
          try {
            compiled = compileTokens(
              file,
              code,
              relative(file),
              resolverFor(file),
            );
          } catch (error) {
            throw diagnostic(error, relative(file));
          }
          modules.set(file, compiled);
          if (previous?.css !== compiled.css) invalidate();

          if (this.environment.name !== "rsc") return compiled.code;
          const registration = `\nimport { registerKeyframes as __fpKeyframes, registerVars as __fpVars } from ${JSON.stringify(
            registryPath,
          )};\n__fpVars(${JSON.stringify(compiled.vars)});\n__fpKeyframes(${JSON.stringify(
            compiled.keyframes,
          )});\n`;
          return `${compiled.code}${registration}`;
        }

        if (IMPORTS_CSS.test(code)) {
          throw new Error(
            `flypath: "css" may only be imported by *.css.ts modules (${relative(
              file,
            )})`,
          );
        }

        if (this.environment.name !== "rsc") return undefined;
        if (!/\.[jt]sx$/.test(file)) return undefined;

        ensureScan();
        const extraction = extractStyles(file, code, resolverFor(file));
        addRules(extraction.rules);
        return extraction.code;
      },
    },
  ];
}
