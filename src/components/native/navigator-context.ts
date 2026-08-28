import type { Context } from "react";
import { createContext, useContext } from "react";

import type { Edge } from "../../router/types.ts";
import type { RscPayload } from "../../runtime/payload.ts";

export type ScreenEntry = {
  kind: "screen";
  key: string;
  url: string;
  container: string;
  safeArea: boolean | readonly Edge[] | undefined;
  presentation: "push" | "modal";
  payload: Promise<RscPayload>;
};

export type ContainerEntry = {
  kind: "container";
  key: string;
  id: string;
};

export type Entry = ScreenEntry | ContainerEntry;

export type ContainerState =
  | { kind: "stack"; entries: readonly Entry[] }
  | { kind: "branches"; active: string };

export type RouterTree = {
  tree: Readonly<Record<string, ContainerState>>;
  fragments: Readonly<Record<string, Promise<RscPayload>>>;
};

export const NavigatorContext: Context<RouterTree | null> =
  createContext<RouterTree | null>(null);

export function useNavigator(): RouterTree {
  const value = useContext(NavigatorContext);
  if (!value) {
    throw new Error("flypath: navigator rendered outside the flypath root");
  }
  return value;
}
