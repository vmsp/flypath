import path from "node:path";

import { defineConfig } from "vitest/config";

import { nativeStub } from "./src/vite/native-stub.ts";

export default defineConfig({
  plugins: [
    nativeStub(path.join(import.meta.dirname, "src/components/native")),
  ],
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
