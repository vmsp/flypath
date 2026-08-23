import type * as React from "react";

import type { Tag } from "../styles/defaults.ts";
import type { StyleProp } from "../styles/types.ts";

type Strict<T> = {
  [K in keyof T]: Omit<T[K], "style"> & { style?: StyleProp };
};

export namespace JSX {
  export type ElementType = React.JSX.ElementType;
  export type Element = React.JSX.Element;
  export type ElementClass = React.JSX.ElementClass;
  export type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
  export type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
  export type LibraryManagedAttributes<C, P> =
    React.JSX.LibraryManagedAttributes<C, P>;
  export type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
  export type IntrinsicClassAttributes<T> =
    React.JSX.IntrinsicClassAttributes<T>;
  export type IntrinsicElements = Strict<
    Pick<React.JSX.IntrinsicElements, Tag>
  >;
}
