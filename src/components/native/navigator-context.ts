import type { Context, ReactNode } from "react";
import { createContext, useContext } from "react";

import type { Edge, Presentation, Transition } from "../../router/types.ts";
import type { RscPayload } from "../../runtime/payload.ts";

export type ScreenEntry = {
  kind: "screen";
  key: string;
  url: string;
  container: string;
  safeArea: boolean | readonly Edge[] | undefined;
  presentation: Presentation;
  transition: Transition;
  gesture: boolean;
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
  epoch: number;
};

export type Content =
  | {
      status: "loading";
      url: string;
      epoch: number;
      at: number;
      promise: Promise<RscPayload>;
    }
  | {
      status: "ready";
      url: string;
      epoch: number;
      at: number;
      node: ReactNode;
      busy: boolean;
    }
  | {
      status: "error";
      url: string;
      epoch: number;
      at: number;
      error: unknown;
    };

export type ContentMap = Readonly<Record<string, Content>>;

export const ABSENT: Content = {
  status: "loading",
  url: "",
  epoch: -1,
  at: 0,
  promise: new Promise<RscPayload>(() => {}),
};

export function chromeKey(id: string): string {
  return `chrome:${id}`;
}

export type NavigatorValue = RouterTree;

export const NavigatorContext: Context<NavigatorValue | null> =
  createContext<NavigatorValue | null>(null);

export function useNavigator(): NavigatorValue {
  const value = useContext(NavigatorContext);
  if (!value) {
    throw new Error("flypath: navigator rendered outside the flypath root");
  }
  return value;
}
