import type { CSSProperties } from "react";

import type { SupportedProperty } from "./properties.ts";

declare const varBrand: unique symbol;
declare const keyframesBrand: unique symbol;
declare const themeBrand: unique symbol;

/** A custom property from `css.vars()`, usable as a style value. */
export type VarToken = string & { readonly [varBrand]: true };

/** An animation name from `css.keyframes()`. */
export type KeyframesToken = string & { readonly [keyframesBrand]: true };

/** Token values from `css.override()`, applied through a `style` prop. */
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

/** Where a value applies: a pseudo-class or a supported media query. */
export type Condition = Pseudo | MediaCondition;

/** One value per condition, with `default` for the unconditional one. */
export type ConditionMap<T> = { default: T } & { [K in Condition]?: T };

type Base = Pick<CSSProperties, SupportedProperty & keyof CSSProperties>;

/** Styles that work on every platform; each value may be a condition map. */
export type StrictStyles = {
  [K in keyof Base]?: Base[K] | ConditionMap<Base[K]>;
};

/**
 * What a `style` prop takes: styles, themes, or an array of them where later
 * entries win and falsy ones are skipped.
 */
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
