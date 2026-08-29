import type { ReactElement } from "react";
import { Fragment } from "react";

import { nativeStyle } from "../styles/native.ts";
import type { JsxFn } from "./element.ts";
import { isMetadata, resolveIntrinsic } from "./intrinsics.ts";

const DEV = process.env.NODE_ENV !== "production";

function nativeProps(
  tag: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const { style, className: _className, ...rest } = props;
  const normalized = nativeStyle(tag, style, DEV);
  if (!normalized) return rest;
  return {
    ...rest,
    $flex: normalized.flex,
    $style: normalized.view,
    $text: normalized.text,
    $theme: normalized.theme,
    $anim: normalized.animation,
  };
}

export function createNativeIntrinsic(
  create: JsxFn,
  type: string,
  props: Record<string, unknown>,
  key?: unknown,
): ReactElement {
  if (isMetadata(type)) return create(Fragment, {}, key);
  return create(resolveIntrinsic(type), nativeProps(type, props), key);
}
