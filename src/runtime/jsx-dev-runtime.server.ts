import type { ReactElement } from "react";
import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";

import { resolveIntrinsic } from "./intrinsics.ts";

export { Fragment };

export function jsxDEV(
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
): ReactElement {
  return (reactJsxDEV as never as JsxDevFn)(
    resolveIntrinsic(type),
    props,
    key,
    isStatic,
    source,
    self,
  );
}

type JsxDevFn = (
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
) => ReactElement;
