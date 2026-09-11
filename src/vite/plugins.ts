import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import type { Plugin, PluginOption } from "vite";

import type { FlypathOptions } from "../native/config.ts";
import { appUrl, buildId, setBuildId } from "../shared/env.ts";
import { report } from "../shared/events.ts";
import { globals } from "../shared/globals.ts";
import { distDir } from "../shared/paths.ts";
import { hash } from "../styles/hash.ts";
import { reporter } from "../terminal/format.ts";
import { isTerminalLogger } from "../terminal/logger.ts";
import type { Handle } from "../terminal/output.ts";
import { open } from "../terminal/output.ts";
import { plural, size } from "../terminal/style.ts";
import { flowStrip } from "./flow.ts";
import { jobsScan } from "./jobs-scan.ts";
import { jobsTransform } from "./jobs.ts";
import { metroEndpoints } from "./metro-endpoints.ts";
import { NATIVE_PLATFORMS, nativeResolve } from "./native-env.ts";
import { nativeModules } from "./native-modules.ts";
import { nativeRefresh } from "./native-refresh.ts";
import { nativeStub } from "./native-stub.ts";
import { prerender } from "./prerender.ts";
import { routes } from "./routes.ts";
import { styles } from "./styles.ts";

const CLIENT_REFERENCES = "virtual:flypath/client-references";
const CLIENT_REFERENCES_ID = `\0${CLIENT_REFERENCES}`;

function clientReferences(): Plugin {
  const nativeDir = path.join(distDir, "components", "native");

  return {
    name: "flypath:client-references",
    resolveId(source) {
      if (source === CLIENT_REFERENCES) return CLIENT_REFERENCES_ID;
      return undefined;
    },
    load(id) {
      if (id !== CLIENT_REFERENCES_ID) return;

      const files = fs
        .readdirSync(nativeDir)
        .filter((file) => file.endsWith(".js") && file !== "index.js")
        .map((file) => path.join(nativeDir, file));

      const imports = files
        .map(
          (file, index) =>
            `import * as m${index} from ${JSON.stringify(file)};`,
        )
        .join("\n");
      const entries = files
        .map((file, index) => `  ${JSON.stringify(file)}: m${index},`)
        .join("\n");

      return `${imports}\nexport const registry = {\n${entries}\n};\n`;
    },
  };
}

const DATABASE = "virtual:flypath/database";
const DATABASE_ID = `\0${DATABASE}`;

function database(options: FlypathOptions): Plugin {
  let root = process.cwd();

  return {
    name: "flypath:database",
    configResolved(config) {
      root = config.root;
    },
    resolveId(source) {
      if (source === DATABASE) return DATABASE_ID;
      return undefined;
    },
    load(id) {
      if (id !== DATABASE_ID) return;
      const configModule = path.join(distDir, "db", "config.js");
      const lines = [
        `import { configureDatabases } from ${JSON.stringify(configModule)};`,
        `configureDatabases(${JSON.stringify(options.databases ?? {})});`,
      ];
      const schema = path.join(root, "db", "schema.ts");
      if (fs.existsSync(schema)) {
        lines.unshift(`import ${JSON.stringify(schema)};`);
      }
      return lines.join("\n") + "\n";
    },
  };
}

const MAIL = "virtual:flypath/mail";
const MAIL_ID = `\0${MAIL}`;

function mail(options: FlypathOptions): Plugin {
  return {
    name: "flypath:mail",
    resolveId(source) {
      if (source === MAIL) return MAIL_ID;
      return undefined;
    },
    load(id) {
      if (id !== MAIL_ID) return;
      const configModule = path.join(distDir, "mail", "config.js");
      const url = appUrl() ?? options.url;
      const declared = {
        ...(url === undefined ? {} : { baseUrl: url }),
        ...options.mail,
      };
      return [
        `import { configureMail } from ${JSON.stringify(configModule)};`,
        `configureMail(${JSON.stringify(declared)});`,
        "",
      ].join("\n");
    },
  };
}

const BUILD = "virtual:flypath/build";
const BUILD_ID = `\0${BUILD}`;

export function currentBuildId(): string {
  const held = buildId();
  if (held !== undefined) return held;
  const id = `${Date.now().toString(36)}-${hash(
    `${String(Date.now())}:${String(process.pid)}:${String(Math.random())}`,
  ).slice(0, 6)}`;
  setBuildId(id);
  return id;
}

function buildInfo(options: FlypathOptions): Plugin {
  return {
    name: "flypath:build-info",
    resolveId(source) {
      if (source === BUILD) return BUILD_ID;
      return undefined;
    },
    load(id) {
      if (id !== BUILD_ID) return;
      const url = appUrl() ?? options.url ?? "";
      return [
        `export const buildId = ${JSON.stringify(currentBuildId())};`,
        `export const appUrl = ${JSON.stringify(url)};`,
        "",
      ].join("\n");
    },
  };
}

const SERVER_ONLY = ["nodemailer"];

function serverOnlyDependencies(): Plugin {
  return {
    name: "flypath:server-only-dependencies",
    config() {
      return {
        environments: {
          rsc: { resolve: { external: SERVER_ONLY } },
          ssr: { resolve: { external: SERVER_ONLY } },
        },
      };
    },
    resolveId(source) {
      const name = this.environment?.name;
      if (name !== "client" && !name?.startsWith("native_")) return undefined;
      if (!SERVER_ONLY.includes(source)) return undefined;
      throw new Error(
        `"${source}" reached the browser bundle. It is a node ` +
          "library the server uses to send mail, so an import of it must " +
          "stay on the server — call sendMail() from a server component, a " +
          "server action or a job",
      );
    },
  };
}

const ENVIRONMENT_LABELS: Record<string, string> = {
  rsc: "server",
  client: "client",
  ssr: "SSR",
};

function progress(): Plugin {
  let enabled = false;
  let analysis: Handle | undefined;
  let analyzed = false;
  const steps = new Map<string, Handle>();
  const modules = new Map<string, number>();
  const scripts = new Map<string, number>();

  return {
    name: "flypath:progress",
    apply: "build",
    sharedDuringBuild: true,
    configResolved(config) {
      enabled = isTerminalLogger(config.logger);
    },
    buildStart() {
      if (!enabled) return;
      const name = this.environment.name;
      modules.set(name, 0);
      if (this.environment.config.build.write === false) {
        if (!analysis && !analyzed) {
          analysis = open({
            active: "Analyzing references",
            done: "Analyzed references",
          });
        }
        return;
      }
      if (analysis) {
        analysis.finish();
        analysis = undefined;
        analyzed = true;
      }
      const label = ENVIRONMENT_LABELS[name] ?? name;
      steps.set(
        name,
        open({
          active: `Building ${label}`,
          done: `Built ${label}`,
          failed: `Build failed for ${label}`,
        }),
      );
    },
    transform: {
      order: "post",
      handler() {
        if (!enabled) return;
        const name = this.environment.name;
        const count = (modules.get(name) ?? 0) + 1;
        modules.set(name, count);
        (steps.get(name) ?? analysis)?.status(plural(count, "module"));
      },
    },
    generateBundle(_options, bundle) {
      if (!enabled || this.environment.config.consumer !== "client") return;
      let total = 0;
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk") total += Buffer.byteLength(item.code);
      }
      scripts.set(this.environment.name, total);
    },
    buildEnd(error) {
      if (!enabled || !error) return;
      const name = this.environment.name;
      const handle = steps.get(name) ?? analysis;
      steps.delete(name);
      if (handle === analysis) analysis = undefined;
      handle?.fail();
    },
    closeBundle() {
      if (!enabled) return;
      const name = this.environment.name;
      const handle = steps.get(name);
      if (!handle) return;
      steps.delete(name);
      const parts = [plural(modules.get(name) ?? 0, "module")];
      const bytes = scripts.get(name);
      if (bytes !== undefined) parts.push(`${size(bytes)} JS`);
      handle.summary(parts.join(" · "));
      handle.finish();
    },
  };
}

function terminal(): Plugin {
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    name: "flypath:terminal",
    apply: "serve",
    configureServer() {
      globals().report = reporter();
    },
    hotUpdate({ file }) {
      const segments = file.split("/");
      if (
        segments.includes("generated") ||
        segments.some((segment) => segment.startsWith("."))
      ) {
        return;
      }
      changed.add(file);
      timer ??= setTimeout(() => {
        timer = undefined;
        for (const entry of changed) report({ kind: "change", file: entry });
        changed.clear();
      }, 25);
    },
  };
}

export function plugins(
  options: FlypathOptions,
  root: () => string,
): PluginOption[] {
  const entry = (name: string) => path.join(distDir, "runtime", name);

  return [
    progress(),
    terminal(),
    database(options),
    mail(options),
    buildInfo(options),
    serverOnlyDependencies(),
    nativeStub(path.join(distDir, "components", "native")),
    clientReferences(),
    routes(),
    jobsTransform(),
    jobsScan(options.jobs ?? {}),
    ...nativeModules(distDir),
    ...NATIVE_PLATFORMS.map((platform) =>
      nativeResolve(distDir, platform, root),
    ),
    ...styles(distDir),
    nativeRefresh(),
    flowStrip(),
    metroEndpoints(distDir),
    react({ jsxImportSource: "flypath" }),
    rsc({
      entries: {
        rsc: entry("server-entry.js"),
        ssr: entry("ssr-entry.js"),
        client: entry("web-entry.js"),
      },
    }),
    prerender(),
  ];
}
