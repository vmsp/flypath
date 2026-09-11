import fs from "node:fs";
import path from "node:path";

export async function devServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${String(port)}/status`, {
      signal: AbortSignal.timeout(1000),
    });
    return (await response.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

export function firstLaunch(root: string, id: string): boolean {
  const file = path.join(root, "node_modules", ".flypath", "launched.json");
  let seen: string[] = [];
  try {
    seen = JSON.parse(fs.readFileSync(file, "utf8")) as string[];
  } catch {}
  if (seen.includes(id)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify([...seen, id])}\n`);
  return true;
}
