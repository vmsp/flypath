import type { RevalidateMode } from "./revalidate.ts";
import type { Mode } from "./types.ts";

export type RouterApi = {
  go: (href: string, mode: Mode) => void;
  back: () => void;
  revalidate: (mode: RevalidateMode) => void;
};

let current: RouterApi | undefined;

export function setRouter(api: RouterApi): () => void {
  current = api;
  return () => {
    if (current === api) current = undefined;
  };
}

export function getRouter(): RouterApi | undefined {
  return current;
}
