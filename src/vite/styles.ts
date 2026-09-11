/**
 * @fileoverview What happens to a `style` prop, and the
 * `virtual:flypath/styles.css` stylesheet this plugin generates.
 *
 * Every `*.css.ts` module is compiled by {@link compileTokens}: `css.vars()`
 * and `css.keyframes()` become real custom properties and `@keyframes`, and the
 * module is rewritten to export the `var(--…)` names that reference them.
 *
 * Every other source file is then scanned by {@link extractStyles}, which
 * evaluates the `style` props it can read statically and replaces them with
 * atomic class names. Those rules, the compiled token declarations and the
 * reset make up the virtual stylesheet: Vite serves it in dev, invalidated over
 * HMR as new rules appear, and emits it as a CSS asset in the build.
 *
 * What survives to runtime is handled per platform. On the web
 * (`styles/web.ts`, applied in `runtime/element.ts`) a value that could not be
 * read statically mints its atomic rule at render time, shipped as a `<style>`
 * React hoists into the head, while plain scalars stay in the inline `style`
 * attribute. On iOS and Android (`styles/native.ts`) there is no CSS at all:
 * properties are translated to their React Native equivalents, split between
 * the view and its text, and `var()`, `rem`, `em` and conditions become
 * descriptors the component resolves against the registry and the current
 * theme, interaction and dimensions. A property with no native equivalent
 * throws in dev and is dropped in release.
 */

import fs from "node:fs";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { sources } from "../shared/paths.ts";
import type { AtomicRule } from "../styles/atomic.ts";
import { RESET } from "../styles/defaults.ts";
import { extractStyles } from "./extract.ts";
import type { Compiled, Resolver } from "./tokens.ts";
import { compileTokens, diagnostic } from "./tokens.ts";

const STYLESHEET = "virtual:flypath/styles.css";
const STYLESHEET_ID = `\0${STYLESHEET}`;

function clean(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

const IMPORTS_CSS = /import\s*\{[^}]*\bcss\b[^}]*\}\s*from\s*["']flypath["']/;

export function styles(distDir: string): Plugin[] {
  const registryPath = path.join(distDir, "styles", "registry.js");
  const modules = new Map<string, Compiled>();
  const atomic = new Map<string, Map<string, AtomicRule[]>>();

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
    const files = sources(root, (name) => name.endsWith(".css.ts"));
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
    for (const file of [...modules.keys()].toSorted()) {
      const compiled = modules.get(file);
      if (compiled && compiled.css !== "") parts.push(compiled.css);
    }
    const rules = new Map<string, string>();
    for (const variants of atomic.values()) {
      for (const entries of variants.values()) {
        for (const rule of entries) rules.set(rule.className, rule.css);
      }
    }
    for (const className of [...rules.keys()].toSorted()) {
      parts.push(rules.get(className) as string);
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

  const replaceRules = (
    file: string,
    variant: string,
    rules: AtomicRule[],
  ): void => {
    let variants = atomic.get(file);
    const previous = variants?.get(variant) ?? [];
    if (
      previous.length === rules.length &&
      previous.every((rule, at) => rule.css === rules[at]?.css)
    ) {
      return;
    }
    if (!variants) {
      variants = new Map();
      atomic.set(file, variants);
    }
    if (rules.length === 0) variants.delete(variant);
    else variants.set(variant, rules);
    if (variants.size === 0) atomic.delete(file);
    invalidate();
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
        if (atomic.delete(file)) invalidate();
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
        } catch {}
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

          const name = this.environment.name;
          if (name !== "rsc" && !name.startsWith("native_")) {
            return compiled.code;
          }
          const registration = `\nimport { registerKeyframes as __fpKeyframes, registerVars as __fpVars } from ${JSON.stringify(
            registryPath,
          )};\n__fpVars(${JSON.stringify(compiled.vars)});\n__fpKeyframes(${JSON.stringify(
            compiled.keyframes,
          )});\n`;
          return `${compiled.code}${registration}`;
        }

        if (IMPORTS_CSS.test(code)) {
          throw new Error(
            `"css" may only be imported by *.css.ts modules (${relative(
              file,
            )})`,
          );
        }

        if (!/\.[jt]sx$/.test(file)) return undefined;

        ensureScan();
        const extraction = extractStyles(file, code, resolverFor(file));
        replaceRules(file, `${this.environment.name}:${id}`, extraction.rules);
        return extraction.code;
      },
    },
  ];
}
