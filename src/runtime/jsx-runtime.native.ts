import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";

import { createNativeIntrinsic } from "./element-native.ts";
import type { JsxFn } from "./element.ts";
import { createJsxRuntime } from "./jsx-factory.ts";

export { Fragment };

const runtime = createJsxRuntime(
  reactJsx as unknown as JsxFn,
  reactJsxs as unknown as JsxFn,
  Fragment,
  (type) => (typeof type === "string" ? createNativeIntrinsic : undefined),
);

export const jsx: JsxFn = runtime.jsx;
export const jsxs: JsxFn = runtime.jsxs;

export type { JSX } from "./jsx.ts";
