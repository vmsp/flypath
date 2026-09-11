import type { ReactElement } from "react";

import type { createIntrinsic, JsxFn } from "./element.ts";

type Resolve = (type: unknown) => typeof createIntrinsic | undefined;

export type JsxDevFn = (
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
) => ReactElement;

export function createJsxRuntime(
  single: JsxFn,
  many: JsxFn,
  fragment: unknown,
  resolve: Resolve,
): { jsx: JsxFn; jsxs: JsxFn } {
  const wrap =
    (create: JsxFn): JsxFn =>
    (type, props, key) => {
      const intrinsic = resolve(type);
      return intrinsic
        ? intrinsic(
            create,
            single,
            many,
            fragment,
            type as string,
            props as Record<string, unknown>,
            key,
          )
        : create(type, props, key);
    };
  return { jsx: wrap(single), jsxs: wrap(many) };
}

export function createJsxDevRuntime(
  jsxDEV: JsxDevFn,
  fragment: unknown,
  resolve: Resolve,
): JsxDevFn {
  return (type, props, key, isStatic, source, self) => {
    const intrinsic = resolve(type);
    if (!intrinsic) return jsxDEV(type, props, key, isStatic, source, self);
    const bind =
      (staticChildren: boolean | undefined): JsxFn =>
      (nextType, nextProps, nextKey) =>
        jsxDEV(nextType, nextProps, nextKey, staticChildren, source, self);
    return intrinsic(
      bind(isStatic),
      bind(false),
      bind(true),
      fragment,
      type as string,
      props as Record<string, unknown>,
      key,
    );
  };
}
