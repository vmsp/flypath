import fs from "node:fs";
import path from "node:path";

import MagicString from "magic-string";
import type { Plugin } from "vite";

import type { NativeManifest, NativeModuleEntry } from "../native/manifest.ts";
import {
  buildManifest,
  componentName,
  DIRECTIVE,
  eventType,
  exportNames,
  ManifestError,
} from "../native/manifest.ts";
import { scaffoldNative } from "../native/scaffold.ts";
import { projectContext } from "../native/template.ts";

let active: NativeManifest | undefined;

export function currentManifest(): NativeManifest | undefined {
  return active;
}

const REFERENCES = "virtual:flypath/native-references";
const REFERENCES_ID = `\0${REFERENCES}`;
const MISSING = "\0flypath:native-web/";

function located(error: unknown): unknown {
  if (!(error instanceof ManifestError)) return error;
  const rollup = error as ManifestError & { id?: string; pos?: number };
  rollup.id = error.file;
  rollup.pos = error.start;
  return rollup;
}

function clean(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

function serverStub(module: NativeModuleEntry): string {
  const bodies = exportNames(module).map((name) => {
    const message = `flypath: ${name} is a device capability declared in ${module.source} and has no server implementation`;
    return `export function ${name}() {\n  throw new Error(${JSON.stringify(
      message,
    )});\n}`;
  });
  return `"use client";\n\n${bodies.join("\n\n")}\n`;
}

function bindingStub(
  module: NativeModuleEntry,
  runtime: string,
  components: string,
): string {
  const functions = module.functions.map(
    (entry) =>
      `export const ${entry.name} = binding(${JSON.stringify(entry.name)});`,
  );
  const views = module.components.map(
    (entry) =>
      `export const ${entry.name} = nativeComponent({ name: ${JSON.stringify(
        componentName(module.slug, entry.name),
      )}, label: ${JSON.stringify(entry.name)}, props: ${JSON.stringify(
        entry.props.map((prop) => prop.name),
      )}, events: ${JSON.stringify(
        entry.events.map((event) => ({
          name: event.name,
          type: eventType(event.name),
          params: event.params.map((param) => param.name),
        })),
      )} });`,
  );

  return [
    `import { nativeModule } from ${JSON.stringify(runtime)};`,
    ...(views.length === 0
      ? []
      : [`import { nativeComponent } from ${JSON.stringify(components)};`]),
    "",
    `const binding = nativeModule(${JSON.stringify(
      module.id,
    )}, ${JSON.stringify(module.source)});`,
    ...functions,
    ...views,
    "",
  ].join("\n");
}

function inlineStub(
  module: NativeModuleEntry,
  code: string,
  runtime: string,
): { code: string; map: null } {
  const output = new MagicString(code);
  for (const entry of module.inline) {
    output.update(
      entry.start,
      entry.end,
      `const ${entry.name} = __flypathBinding(${JSON.stringify(entry.name)});`,
    );
  }
  output.prepend(
    `import { nativeModule as __flypathModule } from ${JSON.stringify(
      runtime,
    )};\nconst __flypathBinding = __flypathModule(${JSON.stringify(
      module.id,
    )}, ${JSON.stringify(module.source)});\n`,
  );
  return { code: output.toString(), map: null };
}

function missingWeb(module: NativeModuleEntry): string {
  const expected = `${module.source.replace(/\.[^.]+$/, "")}.web.tsx`;
  const bodies = exportNames(module).map(
    (name) =>
      `export function ${name}() {\n  throw new Error(${JSON.stringify(
        `flypath: ${name}() has no web implementation (expected ${expected})`,
      )});\n}`,
  );
  return `${bodies.join("\n\n")}\n`;
}

export function nativeModules(distDir: string): Plugin[] {
  const runtime = path.join(distDir, "runtime", "native-bindings.js");
  const components = path.join(distDir, "components", "native", "component.js");

  let root = process.cwd();
  let manifest: NativeManifest | undefined;

  const current = (): NativeManifest => {
    if (!manifest) {
      try {
        manifest = buildManifest(root);
      } catch (error) {
        throw located(error);
      }
      active = manifest;
      generate();
    }
    return manifest;
  };

  const generate = (): void => {
    try {
      scaffoldNative(projectContext(root, 8081));
    } catch {
      return;
    }
  };

  const find = (file: string): NativeModuleEntry | undefined =>
    current().modules.find((module) => module.file === file);

  const invalidate = (file: string): void => {
    if (!manifest) return;
    const known = manifest.modules.some((module) => module.file === file);
    if (!known && !readOr(file).includes(DIRECTIVE)) return;
    manifest = undefined;
    active = undefined;
  };

  const readOr = (file: string): string => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };

  return [
    {
      name: "flypath:native-modules",
      enforce: "pre",
      configResolved(config) {
        root = config.root;
      },
      buildStart() {
        current();
      },
      watchChange(id) {
        invalidate(clean(id));
      },
      async resolveId(source, importer, options) {
        if (source === REFERENCES) return REFERENCES_ID;

        const environment = this.environment?.name ?? "";
        if (environment !== "client" && environment !== "ssr") return undefined;

        const resolved = await this.resolve(source, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved) return undefined;

        const module = find(clean(resolved.id));
        if (!module || module.inline.length > 0) return undefined;
        if (module.web) return module.web;
        return `${MISSING}${module.source}`;
      },
      load(id) {
        if (id === REFERENCES_ID) {
          const environment = this.environment?.name ?? "";
          if (!environment.startsWith("native_")) {
            return "export const nativeReferences = {};\n";
          }
          const modules = current().modules.filter(
            (module) => module.inline.length === 0,
          );
          const imports = modules.map(
            (module, index) =>
              `import * as m${index} from ${JSON.stringify(module.file)};`,
          );
          const entries = modules.map(
            (module, index) => `  ${JSON.stringify(module.id)}: m${index},`,
          );
          return `${imports.join("\n")}\nexport const nativeReferences = {\n${entries.join(
            "\n",
          )}\n};\n`;
        }

        if (id.startsWith(MISSING)) {
          const source = id.slice(MISSING.length);
          const module = current().modules.find(
            (entry) => entry.source === source,
          );
          return module ? missingWeb(module) : undefined;
        }

        return undefined;
      },
      transform(code, id) {
        const file = clean(id);
        if (!code.includes(DIRECTIVE)) return undefined;

        const module = find(file);
        if (!module) return undefined;

        const environment = this.environment?.name ?? "";

        if (module.inline.length > 0) {
          if (!environment.startsWith("native_")) return undefined;
          return inlineStub(module, code, runtime);
        }

        if (environment.startsWith("native_")) {
          return {
            code: bindingStub(module, runtime, components),
            map: null,
          };
        }
        if (environment === "rsc") {
          return { code: serverStub(module), map: null };
        }
        return undefined;
      },
    },
  ];
}
