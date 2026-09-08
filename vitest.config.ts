import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The mail tests import the server jsx runtime itself, to cover that
  // isEmail() is checked before isNative(). That reaches react-native, which is
  // Flow: the rsc build only survives it because @vitejs/plugin-rsc turns the
  // "use client" native elements into client references, and vitest has no such
  // plugin. Stub the barrel, as nativeStub() already does for client and ssr.
  resolve: {
    alias: [
      {
        find: /^\.\.\/components\/native\/index\.ts$/,
        replacement: path.join(import.meta.dirname, "test", "native-stub.ts"),
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    typecheck: {
      enabled: true,
      include: [
        "test/**/*.test-d.ts",
        "test/**/*.test.ts",
        "test/**/*.test.tsx",
      ],
      tsconfig: "tsconfig.test.json",
    },
  },
});
