import path from "node:path";

import type { Plugin } from "vite";

import { TAG_DEFAULTS } from "../styles/defaults.ts";

const STUB_ID = "\0flypath:native-stub";

const STUB_EXPORTS = ["BranchesHost", "StackHost"];

/**
 * Replaces the native components with null placeholders on the client and ssr
 * environments.
 *
 * The rsc graph references them so a flight payload can carry client references
 * the device resolves, and plugin-rsc mirrors every reference it sees into the
 * web builds. This would pull react-native, and its Flow source, into the
 * browser. Neither environment ever renders one. Native payloads are consumed
 * on the device.
 */
export function nativeStub(nativeDir: string): Plugin {
  const dir = nativeDir + path.sep;

  return {
    name: "flypath:native-stub",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const env = this.environment?.name;
      if (env !== "client" && env !== "ssr") return;
      const resolved = await this.resolve(source, importer, options);
      if (!resolved) return;
      if (!resolved.id.startsWith(dir)) return;
      return STUB_ID;
    },
    load(id) {
      if (id !== STUB_ID) return;
      const names = [
        ...Object.keys(TAG_DEFAULTS).map(
          (tag) => `${tag[0]?.toUpperCase() ?? ""}${tag.slice(1)}`,
        ),
        ...STUB_EXPORTS,
      ];
      return [
        "function FlypathNativeStub() { return null; }",
        "export default FlypathNativeStub;",
        "export const nativeIntrinsics = {};",
        ...names.map((name) => `export const ${name} = FlypathNativeStub;`),
      ].join("\n");
    },
  };
}
