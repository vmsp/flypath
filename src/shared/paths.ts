import fs from "node:fs";
import path from "node:path";

export const distDir: string = path.dirname(import.meta.dirname);

export const packageRoot: string = path.dirname(distDir);

const SKIP: ReadonlySet<string> = new Set([
  "android",
  "apple",
  "build",
  "cpp",
  "dist",
  "node_modules",
]);

export const EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
]);

export function sources(
  root: string,
  accept: (name: string) => boolean,
): string[] {
  const out: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        visit(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!accept(entry.name)) continue;
      out.push(path.join(directory, entry.name));
    }
  };
  visit(root);
  return out;
}
