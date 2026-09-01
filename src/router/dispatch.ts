import type { Mode } from "./types.ts";

export type RouterApi = {
  go: (href: string, mode: Mode) => void;
  back: () => void;
};

let current: RouterApi | undefined;

export function setRouter(api: RouterApi | undefined): void {
  current = api;
}

export function getRouter(): RouterApi | undefined {
  return current;
}
