import type { ComponentType, ReactNode } from "react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Linking,
  PixelRatio,
  Platform,
  Pressable,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import type { Tag } from "../../styles/defaults.ts";
import { ROOT_FONT_SIZE, TAG_DEFAULTS } from "../../styles/defaults.ts";
import type { Animation } from "../../styles/native.ts";
import { useAnimation } from "./animation.ts";
import type { FormControl } from "./context.ts";
import { FormContext, InheritedTextContext, ThemeContext } from "./context.ts";
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

function isRawText(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function wrapRawText(children: ReactNode, style: Style): ReactNode {
  if (isRawText(children))
    return <Text style={style as never}>{children}</Text>;
  if (!Array.isArray(children)) return children;

  const out: ReactNode[] = [];
  let run: Array<string | number> = [];
  let index = 0;
  let changed = false;

  const flush = () => {
    if (run.length === 0) return;
    out.push(
      <Text key={`fp-text-${index - run.length}`} style={style as never}>
        {run}
      </Text>,
    );
    run = [];
    changed = true;
  };

  for (const child of children as ReactNode[]) {
    if (isRawText(child)) run.push(child);
    else {
      flush();
      out.push(child);
    }
    index += 1;
  }
  flush();

  return changed ? out : children;
}

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

const AnimatedPressable: ComponentType<Record<string, unknown>> =
  Animated.createAnimatedComponent(
    Pressable as never,
  ) as never as ComponentType<Record<string, unknown>>;

const AnimatedTextInput: ComponentType<Record<string, unknown>> =
  Animated.createAnimatedComponent(
    TextInput as never,
  ) as never as ComponentType<Record<string, unknown>>;

const DEV = process.env["NODE_ENV"] !== "production";

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

type TextInputProps = Record<string, unknown>;

const INPUT_TYPES: Record<string, TextInputProps> = {
  text: {},
  email: { keyboardType: "email-address", autoCapitalize: "none" },
  number: { keyboardType: "numeric" },
  password: { secureTextEntry: true, autoCapitalize: "none" },
  search: { returnKeyType: "search" },
  tel: { keyboardType: "phone-pad" },
  url: { keyboardType: "url", autoCapitalize: "none" },
};

function inputTypeProps(type: unknown): TextInputProps {
  if (type === undefined || type === null) return INPUT_TYPES["text"] as never;
  const mapped = INPUT_TYPES[String(type)];
  if (!mapped) {
    throw new Error(
      `flypath: <input type="${String(type)}"> has no native equivalent`,
    );
  }
  return mapped;
}

type ChangeHandler = (event: unknown) => void;

function changeEvent(value: string, native: unknown): unknown {
  const target = { value };
  return {
    target,
    currentTarget: target,
    type: "change",
    nativeEvent: native,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

function submitEvent(): unknown {
  const target = {};
  return {
    target,
    currentTarget: target,
    type: "submit",
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

function useFormControl(onSubmit: ChangeHandler | undefined): FormControl {
  const handler = useRef(onSubmit);
  useEffect(() => {
    handler.current = onSubmit;
  }, [onSubmit]);
  return useMemo(
    () => ({ submit: () => handler.current?.(submitEvent()) }),
    [],
  );
}

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i;

function openHref(href: unknown): void {
  if (typeof href !== "string" || href === "") return;
  if (!ABSOLUTE_URL.test(href)) {
    if (DEV) {
      console.error(
        `flypath: <a href="${href}"> — relative hrefs need routing, ` +
          "which does not exist yet; only absolute URLs open on native",
      );
    }
    return;
  }
  void Linking.openURL(href);
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
    const form = useContext(FormContext);

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

    const { onClick, onFocus, onBlur, onSubmit, ...attributes } = rest as {
      onClick?: () => void;
      onFocus?: () => void;
      onBlur?: () => void;
      onSubmit?: ChangeHandler;
    } & Record<string, unknown>;

    const control = useFormControl(onSubmit);

    const enterFocus = () => {
      setFocus(true);
      onFocus?.();
    };
    const leaveFocus = () => {
      setFocus(false);
      onBlur?.();
    };

    const handlers = interactive
      ? {
          onPointerEnter: () => setHover(true),
          onPointerLeave: () => setHover(false),
          onFocus: enterFocus,
          onBlur: leaveFocus,
        }
      : { onFocus, onBlur };

    const inheritable = useMemo(
      () => ({ ...inherited, ...text }),
      [inherited, text],
    );

    const style = defaults.text
      ? [inherited, text, view, animated?.style]
      : [view, animated?.style];

    let node: ReactNode;
    if (tag === "img") {
      const Component = animated ? Animated.Image : Image;
      const source =
        typeof attributes["src"] === "string"
          ? { uri: attributes["src"] }
          : undefined;
      const { src: _src, ...imageRest } = attributes;
      node = (
        <Component
          {...imageRest}
          accessibilityRole="image"
          source={source as never}
          style={style as never}
        />
      );
    } else if (tag === "input" || tag === "textarea") {
      const Component = animated ? AnimatedTextInput : TextInput;
      const {
        type,
        value,
        defaultValue,
        disabled,
        rows,
        onChange,
        onInput,
        ...inputRest
      } = attributes as {
        type?: unknown;
        value?: unknown;
        defaultValue?: unknown;
        disabled?: unknown;
        rows?: unknown;
        onChange?: ChangeHandler;
        onInput?: ChangeHandler;
      } & Record<string, unknown>;

      const emit = (event: { nativeEvent: { text: string } }) => {
        const synthetic = changeEvent(
          event.nativeEvent.text,
          event.nativeEvent,
        );
        onChange?.(synthetic);
        onInput?.(synthetic);
      };

      node = (
        <Component
          {...(tag === "input" ? inputTypeProps(type) : {})}
          {...inputRest}
          {...handlers}
          {...(value === undefined
            ? { defaultValue: defaultValue as string | undefined }
            : { value: String(value) })}
          {...(rows === undefined ? {} : { numberOfLines: Number(rows) })}
          editable={disabled === true ? false : undefined}
          multiline={tag === "textarea"}
          onChange={emit}
          onSubmitEditing={
            tag === "input" && form ? () => form.submit() : undefined
          }
          style={style as never}
        />
      );
    } else if (defaults.text) {
      const Component = animated ? Animated.Text : Text;
      const { href, ...textRest } = attributes as {
        href?: unknown;
      } & Record<string, unknown>;
      node = (
        <Component
          {...textRest}
          {...handlers}
          onPress={tag === "a" ? (onClick ?? (() => openHref(href))) : onClick}
          role={defaults.role as never}
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {children}
          </InheritedTextContext.Provider>
        </Component>
      );
    } else if (tag === "button" || onClick !== undefined) {
      const { type, ...buttonRest } = attributes as {
        type?: unknown;
      } & Record<string, unknown>;
      const submits =
        tag === "button" &&
        form !== null &&
        type !== "button" &&
        type !== "reset";
      node = (
        <AnimatedPressable
          {...buttonRest}
          onBlur={leaveFocus}
          onFocus={enterFocus}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          onPress={
            submits
              ? () => {
                  onClick?.();
                  form?.submit();
                }
              : onClick
          }
          onPressIn={() => setActive(true)}
          onPressOut={() => setActive(false)}
          role={defaults.role as never}
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {wrapRawText(children, inheritable)}
          </InheritedTextContext.Provider>
        </AnimatedPressable>
      );
    } else {
      const Component = animated ? Animated.View : View;
      node = (
        <Component
          {...attributes}
          {...handlers}
          role={defaults.role as never}
          style={style as never}
        >
          <InheritedTextContext.Provider value={inheritable}>
            {wrapRawText(children, inheritable)}
          </InheritedTextContext.Provider>
        </Component>
      );
    }

    if (tag === "form") {
      node = (
        <FormContext.Provider value={control}>{node}</FormContext.Provider>
      );
    }

    if (theme === parentTheme) return node;
    return <ThemeContext.Provider value={theme}>{node}</ThemeContext.Provider>;
  }

  Primitive.displayName = `flypath.${tag}`;
  return Primitive;
}
