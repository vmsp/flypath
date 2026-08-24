import type { ReactElement } from "react";
import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";

import { createNativeIntrinsic } from "./element-native.ts";
import type { JsxFn } from "./element.ts";

export { Fragment };

const jsxFn = reactJsx as never as JsxFn;
const jsxsFn = reactJsxs as never as JsxFn;

export function jsx(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  if (typeof type !== "string") return jsxFn(type, props, key);
  return createNativeIntrinsic(
    jsxFn,
    type,
    props as Record<string, unknown>,
    key,
  );
}

export function jsxs(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  if (typeof type !== "string") return jsxsFn(type, props, key);
  return createNativeIntrinsic(
    jsxsFn,
    type,
    props as Record<string, unknown>,
    key,
  );
}

export type { JSX } from "./jsx.ts";
