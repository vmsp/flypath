import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  chunkManifest,
  manifestKeys,
  referenceKey,
  resolveReferences,
  toRelativeId,
  writeChunkManifest,
  writeChunks,
} from "../../src/native/chunks.ts";
import { baseIdOf } from "../../src/vite/bundler.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-chunks-"));
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist", "rsc"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(keys: string[]): void {
  const deps = Object.fromEntries(
    keys.map((key) => [key, { js: [], css: [] }]),
  );
  fs.writeFileSync(
    path.join(root, "dist", "rsc", "__vite_rsc_assets_manifest.js"),
    `export default ${JSON.stringify(
      { clientEntryUrl: "/a.js", clientReferenceDeps: deps },
      null,
      2,
    )};\n`,
  );
}

describe("referenceKey", () => {
  test("is plugin-rsc's key for a known relative id", () => {
    expect(referenceKey("app/counter.tsx")).toBe("ccc04fe24c99");
    expect(referenceKey("app/back-link.tsx")).toBe("97547617b54f");
    expect(referenceKey("app/battery.ts")).toBe("cc51969bd064");
  });

  test("is the first twelve hex characters of the sha256", () => {
    const id = "app/whatever.tsx";
    expect(referenceKey(id)).toBe(
      crypto.createHash("sha256").update(id).digest("hex").slice(0, 12),
    );
  });

  test("uses posix separators regardless of the host", () => {
    expect(toRelativeId(root, path.join(root, "app", "a.tsx"))).toBe(
      "app/a.tsx",
    );
  });
});

describe("resolveReferences", () => {
  test("finds a use client module and pairs it with its key", () => {
    fs.writeFileSync(
      path.join(root, "app", "counter.tsx"),
      '"use client";\n\nexport function Counter() {}\n',
    );
    writeManifest([referenceKey("app/counter.tsx")]);

    const found = resolveReferences(root, path.join(root, "dist", "rsc"));
    expect(found).toHaveLength(1);
    expect(found[0]?.relative).toBe("app/counter.tsx");
  });

  test("finds a use native module too", () => {
    fs.writeFileSync(
      path.join(root, "app", "camera.ts"),
      '"use native";\n\nexport function open(): void {}\n',
    );
    writeManifest([referenceKey("app/camera.ts")]);
    expect(
      resolveReferences(root, path.join(root, "dist", "rsc")),
    ).toHaveLength(1);
  });

  test("skips a module with no directive", () => {
    fs.writeFileSync(
      path.join(root, "app", "plain.tsx"),
      "export const a = 1;",
    );
    writeManifest([]);
    expect(resolveReferences(root, path.join(root, "dist", "rsc"))).toEqual([]);
  });

  test("fails naming the key when the two builds disagree", () => {
    writeManifest(["000000000000"]);
    let caught: unknown;
    try {
      resolveReferences(root, path.join(root, "dist", "rsc"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ details: ["000000000000"] });
  });

  test("reads every key out of clientReferenceDeps", () => {
    const keys = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"];
    writeManifest(keys);
    expect(manifestKeys(path.join(root, "dist", "rsc"))).toEqual(keys);
  });
});

describe("baseIdOf", () => {
  test("ignores the order of the module list", () => {
    const a = baseIdOf("ios", "rn@1", ["b.ts", "a.ts", "c.ts"]);
    const b = baseIdOf("ios", "rn@1", ["a.ts", "b.ts", "c.ts"]);
    expect(a).toBe(b);
  });

  test("changes when a module joins the base", () => {
    const before = baseIdOf("ios", "rn@1", ["a.ts", "b.ts"]);
    const after = baseIdOf("ios", "rn@1", ["a.ts", "b.ts", "c.ts"]);
    expect(after).not.toBe(before);
  });

  test("changes with the platform and with the runtime versions", () => {
    const ios = baseIdOf("ios", "rn@1", ["a.ts"]);
    expect(baseIdOf("android", "rn@1", ["a.ts"])).not.toBe(ios);
    expect(baseIdOf("ios", "rn@2", ["a.ts"])).not.toBe(ios);
  });
});

describe("the chunk manifest", () => {
  test("round trips through disk", () => {
    const chunks = [
      {
        key: "ccc04fe24c99",
        entry: path.join(root, "app", "counter.tsx"),
        file: "ccc04fe24c99-abc.bundle",
        moduleId: 12,
        code: "__d(function () {}, 12, []);\n",
        map: { version: 3, sources: [], names: [], mappings: "" },
        empty: false,
      },
    ];

    const client = path.join(root, "dist", "client");
    writeChunks(client, "ios", chunks);
    const file = writeChunkManifest(
      client,
      "ios",
      chunkManifest("base123", "build456", chunks),
    );

    expect(
      fs.readFileSync(
        path.join(client, "chunk", "ios", "ccc04fe24c99-abc.bundle"),
        "utf8",
      ),
    ).toBe("__d(function () {}, 12, []);\n");
    expect(
      fs.existsSync(
        path.join(client, "chunk", "ios", "ccc04fe24c99-abc.bundle.map"),
      ),
    ).toBe(true);

    const read = JSON.parse(fs.readFileSync(file, "utf8")) as {
      baseId: string;
      build: string;
      chunks: Record<string, string>;
    };
    expect(read.baseId).toBe("base123");
    expect(read.build).toBe("build456");
    expect(read.chunks["ccc04fe24c99"]).toBe("ccc04fe24c99-abc.bundle");
  });
});
