import type { ReactElement } from "react";
import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";

import type { JsxFn } from "./element.ts";
import { createIntrinsic } from "./element.ts";

export { Fragment };

const jsxFn = reactJsx as never as JsxFn;
const jsxsFn = reactJsxs as never as JsxFn;

export function jsx(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  if (typeof type !== "string") return jsxFn(type, props, key);
  return createIntrinsic(
    jsxFn,
    jsxFn,
    jsxsFn,
    Fragment,
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
  return createIntrinsic(
    jsxsFn,
    jsxFn,
    jsxsFn,
    Fragment,
    type,
    props as Record<string, unknown>,
    key,
  );
}

export type { JSX } from "./jsx.ts";
