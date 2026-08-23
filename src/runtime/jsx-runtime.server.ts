import type { ReactElement } from "react";
import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";

import { resolveIntrinsic } from "./intrinsics.ts";

export { Fragment };

export function jsx(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  return (reactJsx as never as JsxFn)(resolveIntrinsic(type), props, key);
}

export function jsxs(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  return (reactJsxs as never as JsxFn)(resolveIntrinsic(type), props, key);
}

type JsxFn = (type: unknown, props: unknown, key?: unknown) => ReactElement;
