import type { Context } from "react";
import { createContext, useContext } from "react";

import type { ManifestTab } from "../../router/manifest.ts";
import type { Edge } from "../../router/types.ts";
import type { RscPayload } from "../../runtime/payload.ts";

export type ScreenState = {
  key: string;
  url: string;
  safeArea: boolean | readonly Edge[] | undefined;
  presentation: "push" | "modal";
  payload: Promise<RscPayload>;
};

export type StackState = {
  stacks: Record<string, readonly ScreenState[]>;
  activeTab: string;
  tabs: readonly ManifestTab[];
};

export const StackContext: Context<StackState | null> =
  createContext<StackState | null>(null);

export function useStacks(): StackState {
  const value = useContext(StackContext);
  if (!value) {
    throw new Error("flypath: navigator rendered outside the flypath root");
  }
  return value;
}
