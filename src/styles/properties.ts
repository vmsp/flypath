export const LONGHANDS = [
  "alignContent",
  "alignItems",
  "alignSelf",
  "animationDelay",
  "animationDirection",
  "animationDuration",
  "animationFillMode",
  "animationIterationCount",
  "animationName",
  "animationTimingFunction",
  "aspectRatio",
  "backgroundColor",
  "borderBottomColor",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderBottomStyle",
  "borderBottomWidth",
  "borderLeftColor",
  "borderLeftStyle",
  "borderLeftWidth",
  "borderRightColor",
  "borderRightStyle",
  "borderRightWidth",
  "borderTopColor",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderTopStyle",
  "borderTopWidth",
  "bottom",
  "boxShadow",
  "color",
  "columnGap",
  "cursor",
  "display",
  "flexBasis",
  "flexDirection",
  "flexGrow",
  "flexShrink",
  "flexWrap",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "height",
  "justifyContent",
  "left",
  "letterSpacing",
  "lineHeight",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "opacity",
  "overflowX",
  "overflowY",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "pointerEvents",
  "position",
  "right",
  "rowGap",
  "textAlign",
  "textDecorationLine",
  "textTransform",
  "top",
  "transform",
  "transformOrigin",
  "userSelect",
  "verticalAlign",
  "width",
  "zIndex",
] as const;

export const SHORTHANDS = [
  "animation",
  "border",
  "borderColor",
  "borderRadius",
  "borderStyle",
  "borderWidth",
  "flex",
  "gap",
  "inset",
  "margin",
  "overflow",
  "padding",
] as const;

export type Longhand = (typeof LONGHANDS)[number];
export type Shorthand = (typeof SHORTHANDS)[number];
export type SupportedProperty = Longhand | Shorthand;

const longhandSet: ReadonlySet<string> = new Set<string>(LONGHANDS);
const shorthandSet: ReadonlySet<string> = new Set<string>(SHORTHANDS);

export function isLonghand(name: string): name is Longhand {
  return longhandSet.has(name);
}

export function isShorthand(name: string): name is Shorthand {
  return shorthandSet.has(name);
}

export function isSupported(name: string): name is SupportedProperty {
  return longhandSet.has(name) || shorthandSet.has(name);
}

const WEB_ONLY: ReadonlySet<string> = new Set([
  "transformOrigin",
  "verticalAlign",
]);

export function isNativeProperty(name: string): boolean {
  return longhandSet.has(name) && !WEB_ONLY.has(name);
}

export const TEXT_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textDecorationLine",
  "textTransform",
]);

export const SCROLL_CONTENT: ReadonlySet<string> = new Set([
  "alignContent",
  "alignItems",
  "columnGap",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "rowGap",
]);

const UNITLESS: ReadonlySet<string> = new Set([
  "animationIterationCount",
  "aspectRatio",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "zIndex",
]);

export function isUnitless(name: string): boolean {
  return UNITLESS.has(name);
}

export function hyphenate(name: string): string {
  return name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}
