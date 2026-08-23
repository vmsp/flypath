import type { ComponentType, ReactNode } from "react";
import { useContext, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  PixelRatio,
  Platform,
  Pressable,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import type { Tag } from "../../styles/defaults.ts";
import { ROOT_FONT_SIZE, TAG_DEFAULTS } from "../../styles/defaults.ts";
import type { Animation } from "../../styles/native.ts";
import { useAnimation } from "./animation.ts";
import { InheritedTextContext, ThemeContext } from "./context.ts";
import type { Env, Style } from "./resolve.ts";
import { resolve, resolveStyle, resolveTheme } from "./resolve.ts";

export type PrimitiveProps = {
  $style?: Style;
  $text?: Style;
  $theme?: Style;
  $anim?: Animation;
  children?: ReactNode;
  [key: string]: unknown;
};

function usesPseudo(style: Style | undefined): boolean {
  if (!style) return false;
  for (const value of Object.values(style)) {
    if (value === null || typeof value !== "object") continue;
    const cond = (
      value as { $cond?: { c: [Record<string, unknown>, unknown][] } }
    ).$cond;
    if (!cond) continue;
    for (const [predicate] of cond.c) {
      if (predicate["hover"] || predicate["active"] || predicate["focus"]) {
        return true;
      }
    }
  }
  return false;
}

function useReduceMotion(): boolean {
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

const GENERIC_FONTS: Record<string, string | undefined> = {
  monospace: Platform.select({ ios: "Menlo", default: "monospace" }),
  serif: Platform.select({ ios: "Times New Roman", default: "serif" }),
  "sans-serif": undefined,
  "system-ui": undefined,
};

function withFontFamily(style: Style): Style {
  const family = style["fontFamily"];
  if (typeof family !== "string" || !(family in GENERIC_FONTS)) return style;
  return { ...style, fontFamily: GENERIC_FONTS[family] };
}

export function createPrimitive(tag: Tag): ComponentType<PrimitiveProps> {
  const defaults = TAG_DEFAULTS[tag];

  function Primitive(props: PrimitiveProps): ReactNode {
    const { $style, $text, $theme, $anim, children, ...rest } = props;

    const { width, height } = useWindowDimensions();
    const scheme = useColorScheme() === "dark" ? "dark" : "light";
    const reduceMotion = useReduceMotion();
    const parentTheme = useContext(ThemeContext);
    const inherited = useContext(InheritedTextContext);

    const interactive =
      usesPseudo($style) || usesPseudo($text) || tag === "button";
    const [hover, setHover] = useState(false);
    const [active, setActive] = useState(false);
    const [focus, setFocus] = useState(false);

    const rootFontSize = ROOT_FONT_SIZE * PixelRatio.getFontScale();
    const inheritedFontSize = Number(inherited["fontSize"] ?? rootFontSize);

    const base: Env = useMemo(
      () => ({
        width,
        height,
        scheme,
        reduceMotion,
        hover,
        active,
        focus,
        fontSize: inheritedFontSize,
        rootFontSize,
        theme: parentTheme,
      }),
      [
        active,
        focus,
        height,
        hover,
        inheritedFontSize,
        parentTheme,
        reduceMotion,
        rootFontSize,
        scheme,
        width,
      ],
    );

    const theme = useMemo(
      () => resolveTheme($theme, base) ?? parentTheme,
      [$theme, base, parentTheme],
    );

    const env: Env = useMemo(() => {
      const scoped: Env = { ...base, theme };
      const own = $text?.["fontSize"] ?? defaults.style["fontSize"];
      const fontSize =
        own === undefined ? inheritedFontSize : Number(resolve(own, scoped));
      return { ...scoped, fontSize };
    }, [$text, base, inheritedFontSize, theme]);

    const view = useMemo(() => resolveStyle($style, env), [$style, env]);
    const text = useMemo(
      () => withFontFamily({ ...defaults.style, ...resolveStyle($text, env) }),
      [$text, env],
    );

    const animated = useAnimation($anim, env);

    const inheritable = useMemo(
      () => ({ ...inherited, ...text }),
      [inherited, text],
    );

    const handlers = interactive
      ? {
          onPointerEnter: () => setHover(true),
          onPointerLeave: () => setHover(false),
          onFocus: () => setFocus(true),
          onBlur: () => setFocus(false),
        }
      : {};

    const style = defaults.text
      ? [inherited, text, view, animated?.style]
      : [view, animated?.style];

    let node: ReactNode;
    if (tag === "img") {
      const Component = animated ? Animated.Image : Image;
      const source =
        typeof rest["src"] === "string" ? { uri: rest["src"] } : undefined;
      const { src: _src, ...imageRest } = rest;
      node = (
        <Component
          {...imageRest}
          accessibilityRole="image"
          source={source as never}
          style={style as never}
        />
      );
    } else if (tag === "button") {
      node = (
        <Pressable
          {...rest}
          onBlur={() => setFocus(false)}
          onFocus={() => setFocus(true)}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          onPressIn={() => setActive(true)}
          onPressOut={() => setActive(false)}
          role="button"
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {children}
          </InheritedTextContext.Provider>
        </Pressable>
      );
    } else if (defaults.text) {
      const Component = animated ? Animated.Text : Text;
      node = (
        <Component
          {...rest}
          {...handlers}
          role={defaults.role as never}
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {children}
          </InheritedTextContext.Provider>
        </Component>
      );
    } else {
      const Component = animated ? Animated.View : View;
      node = (
        <Component
          {...rest}
          {...handlers}
          role={defaults.role as never}
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {children}
          </InheritedTextContext.Provider>
        </Component>
      );
    }

    if (theme === parentTheme) return node;
    return <ThemeContext.Provider value={theme}>{node}</ThemeContext.Provider>;
  }

  Primitive.displayName = `flypath.${tag}`;
  return Primitive;
}
