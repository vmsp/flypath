import type {
  KeyframesInput,
  KeyframesToken,
  Theme,
  VarToken,
  VarValue,
} from "./types.ts";

export type Css = {
  /**
   * Declare custom properties. Each value may be a scalar or a map keyed by
   * `@media` conditions, and the returned tokens are usable wherever a style
   * value is.
   */
  vars: <T extends Record<string, VarValue>>(
    tokens: T,
  ) => { [K in keyof T]: VarToken };

  /**
   * Rebind tokens to new values. Pass the theme in a `style` prop to scope the
   * new values to that subtree.
   */
  override: <T extends Record<string, VarToken>>(
    tokens: T,
    values: Partial<Record<keyof T, VarValue>>,
  ) => Theme;

  /** Declare an animation; the token names it for `animationName`. */
  keyframes: (frames: KeyframesInput) => KeyframesToken;
};

function unreachable(name: string): never {
  throw new Error(
    `css.${name}() was not compiled away. It may only be called at ` +
      "the top level of a *.css.ts module.",
  );
}

/**
 * Style tokens: custom properties, themes and keyframes. The calls are compiled
 * away into real CSS, so they only run at the top level of a `*.css.ts` module.
 */
export const css: Css = {
  vars: () => unreachable("vars"),
  override: () => unreachable("override"),
  keyframes: () => unreachable("keyframes"),
};
