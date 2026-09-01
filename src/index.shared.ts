import type { ComponentType } from "react";

import type { StyleProp } from "./styles/types.ts";

export { css } from "./styles/css.ts";
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
export { platform, isAndroid, isIos, isNative } from "./runtime/platform.ts";
export { href } from "./router/href.ts";
export type {
  Destination,
  ExternalHref,
  Href,
  Navigate,
  Params,
  ParamsReader,
  Pattern,
  QueryReader,
  SearchParams,
} from "./router/types.ts";

export type NativeComponent<Props> = ComponentType<
  Props & { style?: StyleProp }
>;
