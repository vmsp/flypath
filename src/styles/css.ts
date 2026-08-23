import type {
  KeyframesInput,
  KeyframesToken,
  Theme,
  VarToken,
  VarValue,
} from "./types.ts";

export type Css = {
  vars: <T extends Record<string, VarValue>>(
    tokens: T,
  ) => { [K in keyof T]: VarToken };
  override: <T extends Record<string, VarToken>>(
    tokens: T,
    values: Partial<Record<keyof T, VarValue>>,
  ) => Theme;
  keyframes: (frames: KeyframesInput) => KeyframesToken;
};

function unreachable(name: string): never {
  throw new Error(
    `flypath: css.${name}() was not compiled away. It may only be called at ` +
      "the top level of a *.css.ts module.",
  );
}

export const css: Css = {
  vars: () => unreachable("vars"),
  override: () => unreachable("override"),
  keyframes: () => unreachable("keyframes"),
};
