import { Db } from "./query.ts";

export function db(options: { name?: string } = {}): Db<Record<never, never>> {
  return new Db<Record<never, never>>(options.name ?? "default");
}
