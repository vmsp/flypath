import type { ReactElement } from "react";
import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";

import { createNativeIntrinsic } from "./element-native.ts";
import type { JsxFn } from "./element.ts";

export { Fragment };

type JsxDevFn = (
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
) => ReactElement;

const jsxDevFn = reactJsxDEV as never as JsxDevFn;

export function jsxDEV(
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
): ReactElement {
  if (typeof type !== "string") {
    return jsxDevFn(type, props, key, isStatic, source, self);
  }
  const create: JsxFn = (nextType, nextProps, nextKey) =>
    jsxDevFn(nextType, nextProps, nextKey, isStatic, source, self);
  return createNativeIntrinsic(
    create,
    type,
    props as Record<string, unknown>,
    key,
  );
}

export type { JSX } from "./jsx.ts";
