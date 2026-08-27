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

export type NativeComponent<Props> = ComponentType<
  Props & { style?: StyleProp }
>;
