import type { ReactElement } from "react";
import {
  Fragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";

import { isEmail } from "../mail/context.ts";
import {
  assertNoClientReference,
  createEmailIntrinsic,
} from "./element-email.ts";
import { createNativeIntrinsic } from "./element-native.ts";
import type { JsxFn } from "./element.ts";
import { createIntrinsic } from "./element.ts";
import { isNative } from "./platform.ts";

export { Fragment };

const jsxFn = reactJsx as never as JsxFn;
const jsxsFn = reactJsxs as never as JsxFn;

export function jsx(
  type: unknown,
  props: unknown,
  key?: unknown,
): ReactElement {
  if (typeof type !== "string") {
    if (isEmail()) assertNoClientReference(type);
    return jsxFn(type, props, key);
  }
  if (isEmail()) {
    return createEmailIntrinsic(
      jsxFn,
      jsxFn,
      jsxsFn,
      Fragment,
      type,
      props as Record<string, unknown>,
      key,
    );
  }
  if (isNative()) {
    return createNativeIntrinsic(
      jsxFn,
      type,
      props as Record<string, unknown>,
      key,
    );
  }
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
  if (typeof type !== "string") {
    if (isEmail()) assertNoClientReference(type);
    return jsxsFn(type, props, key);
  }
  if (isEmail()) {
    return createEmailIntrinsic(
      jsxsFn,
      jsxFn,
      jsxsFn,
      Fragment,
      type,
      props as Record<string, unknown>,
      key,
    );
  }
  if (isNative()) {
    return createNativeIntrinsic(
      jsxsFn,
      type,
      props as Record<string, unknown>,
      key,
    );
  }
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
