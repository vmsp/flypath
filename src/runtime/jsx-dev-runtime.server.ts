import type { ReactElement } from "react";
import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";

import type { JsxFn } from "./element.ts";
import { createIntrinsic } from "./element.ts";

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
  const single: JsxFn = (nextType, nextProps, nextKey) =>
    jsxDevFn(nextType, nextProps, nextKey, false, source, self);
  const many: JsxFn = (nextType, nextProps, nextKey) =>
    jsxDevFn(nextType, nextProps, nextKey, true, source, self);
  return createIntrinsic(
    create,
    single,
    many,
    Fragment,
    type,
    props as Record<string, unknown>,
    key,
  );
}

export type { JSX } from "./jsx.ts";
