import type { ReactElement } from "react";

import { nativeStyle } from "../styles/native.ts";
import { webStyle } from "../styles/web.ts";
import { resolveIntrinsic } from "./intrinsics.ts";
import { isNative } from "./platform.ts";

export type JsxFn = (
  type: unknown,
  props: unknown,
  key?: unknown,
) => ReactElement;

const DEV = process.env["NODE_ENV"] !== "production";

const hoisted = new WeakMap<object, ReactElement[]>();

function styleElements(
  jsx: JsxFn,
  rules: { className: string; css: string }[],
  owner: object,
): ReactElement[] {
  const cached = hoisted.get(owner);
  if (cached) return cached;
  const elements = rules.map((rule) =>
    jsx(
      "style",
      { href: rule.className, precedence: "flypath", children: rule.css },
      rule.className,
    ),
  );
  hoisted.set(owner, elements);
  return elements;
}

function nativeProps(
  tag: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const { style, className: _className, ...rest } = props;
  const normalized = nativeStyle(tag, style, DEV);
  if (!normalized) return rest;
  return {
    ...rest,
    $style: normalized.view,
    $text: normalized.text,
    $theme: normalized.theme,
    $anim: normalized.animation,
  };
}

export function createIntrinsic(
  create: JsxFn,
  jsx: JsxFn,
  jsxs: JsxFn,
  fragment: unknown,
  type: string,
  props: Record<string, unknown>,
  key?: unknown,
): ReactElement {
  if (isNative()) {
    return create(resolveIntrinsic(type), nativeProps(type, props), key);
  }

  const style = props["style"];
  if (style === undefined || style === null) return create(type, props, key);

  const resolved = webStyle(style);
  const next: Record<string, unknown> = { ...props };
  if (resolved.style === undefined) delete next["style"];
  else next["style"] = resolved.style;

  if (resolved.classes.length > 0) {
    const existing = props["className"];
    next["className"] = [
      typeof existing === "string" ? existing : undefined,
      ...resolved.classes,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const element = create(type, next, key);
  if (resolved.rules.length === 0) return element;

  return jsxs(
    fragment,
    {
      children: [...styleElements(jsx, resolved.rules, resolved), element],
    },
    key,
  );
}
