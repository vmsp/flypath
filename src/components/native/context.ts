import type { Context } from "react";
import { createContext } from "react";

import { INHERITED_ROOT } from "../../styles/defaults.ts";
import type { Style } from "./resolve.ts";

export const ThemeContext: Context<Record<string, unknown>> = createContext<
  Record<string, unknown>
>({});

export const InheritedTextContext: Context<Style> = createContext<Style>({
  ...INHERITED_ROOT,
});
