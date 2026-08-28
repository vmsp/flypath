import type { ComponentType } from "react";

import type { StyleProp } from "./styles/types.ts";

export { css } from "./styles/css.ts";
export type { Css } from "./styles/css.ts";
export type {
  Condition,
  ConditionMap,
  KeyframesToken,
  StrictStyles,
  StyleProp,
  Theme,
  VarToken,
} from "./styles/types.ts";
export type { Platform } from "./runtime/platform.ts";
export { SafeAreaView } from "./components/safe-area.ts";
export { TabBar } from "./components/tab-bar.ts";
export type { TabBarProps } from "./components/tab-bar.ts";
export type { SafeAreaViewProps } from "./components/safe-area.ts";
export { href } from "./router/href.ts";
export {
  NavigationError,
  navigationSignal,
  notFound,
  redirect,
} from "./router/navigation.ts";
export type { NavigationSignal } from "./router/navigation.ts";
export { joinPattern, matchPattern, normalizePath } from "./router/path.ts";
export type {
  Edge,
  ExternalHref,
  Href,
  PageProps,
  Params,
  Pattern,
  Presentation,
  RouteOptions,
  SearchParams,
} from "./router/types.ts";

export type NativeComponent<Props> = ComponentType<
  Props & { style?: StyleProp }
>;
