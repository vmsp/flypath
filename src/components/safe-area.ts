import type { ReactElement, ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import type { Edge } from "../router/types.ts";
import { createNativeIntrinsic } from "../runtime/element-native.ts";
import type { JsxFn } from "../runtime/element.ts";
import { createIntrinsic } from "../runtime/element.ts";
import { isNative } from "../runtime/platform.ts";
import type { StyleProp } from "../styles/types.ts";

export type SafeAreaViewProps = {
  edges?: boolean | readonly Edge[];
  style?: StyleProp;
  children?: ReactNode;
};

const ALL_EDGES: readonly Edge[] = ["top", "bottom", "left", "right"];

function edgeList(
  edges: boolean | readonly Edge[] | undefined,
): readonly Edge[] {
  if (edges === undefined || edges === true) return ALL_EDGES;
  if (edges === false) return [];
  return edges;
}

const PADDING: Record<Edge, string> = {
  top: "paddingTop",
  bottom: "paddingBottom",
  left: "paddingLeft",
  right: "paddingRight",
};

const jsxFn = jsx as never as JsxFn;
const jsxsFn = jsxs as never as JsxFn;

export function SafeAreaView(props: SafeAreaViewProps): ReactElement {
  const edges = edgeList(props.edges);

  if (isNative()) {
    return createNativeIntrinsic(jsxFn, "div", {
      style: props.style,
      $safeArea: edges,
      children: props.children,
    });
  }

  const insets: Record<string, string> = {};
  for (const edge of edges) {
    insets[PADDING[edge]] = `env(safe-area-inset-${edge})`;
  }

  return createIntrinsic(jsxFn, jsxFn, jsxsFn, Fragment, "div", {
    style: [insets, props.style],
    children: props.children,
  });
}
