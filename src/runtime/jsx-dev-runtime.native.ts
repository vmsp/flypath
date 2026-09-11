import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";

import { createNativeIntrinsic } from "./element-native.ts";
import type { JsxDevFn } from "./jsx-factory.ts";
import { createJsxDevRuntime } from "./jsx-factory.ts";

export { Fragment };

export const jsxDEV: JsxDevFn = createJsxDevRuntime(
  reactJsxDEV as unknown as JsxDevFn,
  Fragment,
  (type) => (typeof type === "string" ? createNativeIntrinsic : undefined),
);

export type { JSX } from "./jsx.ts";
