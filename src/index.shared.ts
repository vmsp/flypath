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
export type { HeaderAccess, Platform } from "./runtime/platform.ts";
export {
  headers,
  isAndroid,
  isIos,
  isNative,
  isPrefetch,
  platform,
} from "./runtime/platform.ts";
export type { CookieOptions, Cookies, SameSite } from "./runtime/cookies.ts";
export { cookies } from "./runtime/cookies.ts";
export type { Context } from "./router/context.ts";
export { context } from "./router/context.ts";
export { href } from "./router/href.ts";
export type { Middleware, Next } from "./router/middleware.ts";
export type {
  Destination,
  ExternalHref,
  Href,
  Navigate,
  Params,
  ParamsReader,
  Pattern,
  QueryReader,
  Revalidate,
  SearchParams,
} from "./router/types.ts";

export type NativeComponent<Props> = ComponentType<
  Props & { style?: StyleProp }
>;
