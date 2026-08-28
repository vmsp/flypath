import type { Context } from "react";
import { createContext, useContext } from "react";

import type { Edge } from "../../router/types.ts";

export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export const ZERO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

export const InsetsContext: Context<Insets> =
  createContext<Insets>(ZERO_INSETS);

export function useInsets(): Insets {
  return useContext(InsetsContext);
}

const ALL_EDGES: readonly Edge[] = ["top", "bottom", "left", "right"];

export function edgesOf(
  value: boolean | readonly Edge[] | undefined,
): readonly Edge[] {
  if (value === undefined || value === true) return ALL_EDGES;
  if (value === false) return [];
  return value;
}

export function insetPadding(
  insets: Insets,
  edges: readonly Edge[],
): Record<string, number> {
  const style: Record<string, number> = {};
  if (edges.includes("top")) style["paddingTop"] = insets.top;
  if (edges.includes("bottom")) style["paddingBottom"] = insets.bottom;
  if (edges.includes("left")) style["paddingLeft"] = insets.left;
  if (edges.includes("right")) style["paddingRight"] = insets.right;
  return style;
}
