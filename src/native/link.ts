import fs from "node:fs";
import path from "node:path";

export function link(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  fs.symlinkSync(from, to);
}

export function list(dir: string, extensions: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() && extensions.includes(path.extname(entry.name)),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort();
}
