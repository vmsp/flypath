import type { CSSProperties } from "react";

import type { SupportedProperty } from "./properties.ts";

declare const varBrand: unique symbol;
declare const keyframesBrand: unique symbol;
declare const themeBrand: unique symbol;

export type VarToken = string & { readonly [varBrand]: true };
export type KeyframesToken = string & { readonly [keyframesBrand]: true };
export type Theme = { readonly [themeBrand]: true };

type Pseudo = ":hover" | ":active" | ":focus";

type Length = `${number}px` | `${number}em` | `${number}rem`;

type MediaCondition =
  | `@media (min-width: ${Length})`
  | `@media (max-width: ${Length})`
  | `@media (min-height: ${Length})`
  | `@media (max-height: ${Length})`
  | `@media (prefers-color-scheme: dark)`
  | `@media (prefers-color-scheme: light)`
  | `@media (prefers-reduced-motion: reduce)`
  | `@media (prefers-reduced-motion: no-preference)`;

export type Condition = Pseudo | MediaCondition;

export type ConditionMap<T> = { default: T } & { [K in Condition]?: T };

type Base = Pick<CSSProperties, SupportedProperty & keyof CSSProperties>;

export type StrictStyles = {
  [K in keyof Base]?: Base[K] | ConditionMap<Base[K]>;
};

export type StyleProp =
  | StrictStyles
  | Theme
  | ReadonlyArray<StrictStyles | Theme | false | null | undefined>;

export type VarValue = string | number | ConditionMap<string | number>;

type Keyframe = {
  [K in keyof Base]?: Base[K];
};

export type KeyframesInput = {
  [offset: string]: Keyframe;
};
