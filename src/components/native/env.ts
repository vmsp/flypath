import { useContext, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  PixelRatio,
  useColorScheme,
  useWindowDimensions,
} from "react-native";

import { ROOT_FONT_SIZE } from "../../styles/defaults.ts";
import { InheritedTextContext, ThemeContext } from "./context.ts";
import type { Env } from "./resolve.ts";

export type Interaction = {
  hover: boolean;
  active: boolean;
  focus: boolean;
};

export const IDLE_INTERACTION: Interaction = {
  hover: false,
  active: false,
  focus: false,
};

export function useReduceMotion(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((next) => {
      if (mounted) setValue(next);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setValue,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return value;
}

export function useStyleEnv(interaction: Interaction): Env {
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const reduceMotion = useReduceMotion();
  const theme = useContext(ThemeContext);
  const inherited = useContext(InheritedTextContext);

  const rootFontSize = ROOT_FONT_SIZE * PixelRatio.getFontScale();
  const fontSize = Number(inherited["fontSize"] ?? rootFontSize);
  const { hover, active, focus } = interaction;

  return useMemo(
    () => ({
      width,
      height,
      scheme,
      reduceMotion,
      hover,
      active,
      focus,
      fontSize,
      rootFontSize,
      theme,
    }),
    [
      active,
      focus,
      fontSize,
      height,
      hover,
      reduceMotion,
      rootFontSize,
      scheme,
      theme,
      width,
    ],
  );
}
