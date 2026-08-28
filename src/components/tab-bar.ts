import type { ReactElement } from "react";
import { createElement, Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { manifest } from "virtual:flypath/route-manifest";

import { boundaryOf } from "../router/manifest.ts";
import type { JsxFn } from "../runtime/element.ts";
import { createIntrinsic } from "../runtime/element.ts";
import { getPathname, isNative } from "../runtime/platform.ts";
import type { StyleProp } from "../styles/types.ts";
import { NativeTabBar } from "./native/navigator.tsx";

export type TabBarProps = {
  style?: StyleProp;
};

const jsxFn = jsx as never as JsxFn;
const jsxsFn = jsxs as never as JsxFn;

const BAR: Record<string, string | number> = {
  borderTopColor: "#e2e2e2",
  borderTopStyle: "solid",
  borderTopWidth: 1,
  display: "flex",
  flexDirection: "row",
  gap: 8,
  paddingBottom: 12,
  paddingTop: 12,
};

const LINK: Record<string, string | number> = {
  color: "#555",
  flexGrow: 1,
  textAlign: "center",
  textDecorationLine: "none",
};

const ACTIVE: Record<string, string | number> = {
  color: "#0b5cff",
  fontWeight: "600",
};

export function TabBar(props: TabBarProps = {}): ReactElement {
  if (isNative()) return createElement(NativeTabBar);

  const boundary = boundaryOf(manifest, manifest.navigator);
  const pathname = getPathname();

  const links = (boundary?.tabs ?? []).map((tab) =>
    createIntrinsic(
      jsxFn,
      jsxFn,
      jsxsFn,
      Fragment,
      "a",
      {
        href: tab.path,
        style: [LINK, tab.path === pathname ? ACTIVE : null],
        children: tab.title ?? tab.path,
        ...(tab.path === pathname ? { "aria-current": "page" } : {}),
      },
      tab.key,
    ),
  );

  return createIntrinsic(jsxFn, jsxFn, jsxsFn, Fragment, "nav", {
    style: [BAR, props.style],
    children: links,
  });
}
