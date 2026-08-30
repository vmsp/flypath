import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type PreludeOptions = {
  root: string;
  platform: string;
  dev: boolean;
  serverUrl: string;
  manifestHash: string;
};

function metroRequirePolyfill(root: string): string {
  const require = createRequire(path.join(root, "index.js"));
  const entry = require.resolve("metro-runtime/package.json");
  const file = path.join(path.dirname(entry), "src", "polyfills", "require.js");
  return fs.readFileSync(file, "utf8");
}

export function nativePrelude(options: PreludeOptions): string {
  const dev = options.dev ? "true" : "false";
  const nodeEnv = JSON.stringify(options.dev ? "development" : "production");

  return `var __GLOBAL__ = typeof globalThis !== "undefined" ? globalThis : this;
__GLOBAL__.global = __GLOBAL__;
__GLOBAL__.__DEV__ = ${dev};
__GLOBAL__.__METRO_GLOBAL_PREFIX__ = "";
__GLOBAL__.process = __GLOBAL__.process || {};
__GLOBAL__.process.env = __GLOBAL__.process.env || {};
__GLOBAL__.process.env.NODE_ENV = ${nodeEnv};
__GLOBAL__.__FLYPATH__ = {
  platform: ${JSON.stringify(options.platform)},
  serverUrl: ${JSON.stringify(options.serverUrl)},
  dev: ${dev},
  manifestHash: ${JSON.stringify(options.manifestHash)},
};
(function (global) {
${metroRequirePolyfill(options.root)}

function cjsNamespace(value) {
  return new Proxy({}, {
    get: function (_target, key) {
      if (key === "default") return value;
      if (key === "__esModule") return true;
      return value == null ? undefined : value[key];
    },
    has: function (_target, key) {
      if (key === "default" || key === "__esModule") return true;
      return value == null ? false : key in Object(value);
    },
    ownKeys: function () {
      var keys = value == null ? [] : Reflect.ownKeys(Object(value));
      if (keys.indexOf("default") === -1) keys.push("default");
      return keys;
    },
    getOwnPropertyDescriptor: function (_target, key) {
      if (key === "default") {
        return { value: value, enumerable: true, configurable: true, writable: true };
      }
      if (value == null) return undefined;
      var descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
      if (descriptor) descriptor.configurable = true;
      return descriptor;
    },
  });
}

global.__flypathNamespace = function (moduleId) {
  var exports = global.__r(moduleId);
  return exports && exports.__esModule ? exports : cjsNamespace(exports);
};

global.__flypathLazy = function (moduleId) {
  var namespace = null;
  function target() {
    if (namespace === null) namespace = global.__flypathNamespace(moduleId);
    return namespace;
  }
  return new Proxy({}, {
    get: function (_target, key) {
      return target()[key];
    },
    has: function (_target, key) {
      return key in target();
    },
    ownKeys: function () {
      return Reflect.ownKeys(target());
    },
    getOwnPropertyDescriptor: function (_target, key) {
      var descriptor = Object.getOwnPropertyDescriptor(target(), key);
      if (descriptor) descriptor.configurable = true;
      return descriptor;
    },
  });
};
})(__GLOBAL__);
`;
}
