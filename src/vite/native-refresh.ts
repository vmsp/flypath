import path from "node:path";

import type { Plugin } from "vite";
import { transformWithOxc } from "vite";

import { nativeEnvironmentName, NATIVE_PLATFORMS } from "./native-env.ts";

const NATIVE_ENVIRONMENTS = new Set(
  NATIVE_PLATFORMS.map((platform) => nativeEnvironmentName(platform)),
);

const COMPONENT = /\.[jt]sx$/;

function clean(id: string): string {
  const query = id.indexOf("?");
  return query === -1 ? id : id.slice(0, query);
}

export function nativeRefresh(): Plugin {
  let root = process.cwd();

  return {
    name: "flypath:native-refresh",
    enforce: "post",
    apply: "serve",
    applyToEnvironment(environment) {
      return NATIVE_ENVIRONMENTS.has(environment.name);
    },
    configResolved(config) {
      root = config.root;
    },
    async transform(code, id) {
      const file = clean(id);
      if (!COMPONENT.test(file)) return undefined;
      if (!file.startsWith(root + path.sep)) return undefined;
      if (file.includes(`${path.sep}node_modules${path.sep}`)) return undefined;

      const result = await transformWithOxc(code, file, {
        jsx: { refresh: true },
        lang: "js",
        sourcemap: true,
      });

      return { code: result.code, map: result.map };
    },
  };
}
