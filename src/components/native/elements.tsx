"use client";

import type { ComponentType } from "react";

import type { PrimitiveProps } from "./primitive.tsx";
import { createPrimitive } from "./primitive.tsx";

export const A: ComponentType<PrimitiveProps> = createPrimitive("a");
export const Article: ComponentType<PrimitiveProps> =
  createPrimitive("article");
export const Aside: ComponentType<PrimitiveProps> = createPrimitive("aside");
export const B: ComponentType<PrimitiveProps> = createPrimitive("b");
export const Blockquote: ComponentType<PrimitiveProps> =
  createPrimitive("blockquote");
export const Button: ComponentType<PrimitiveProps> = createPrimitive("button");
export const Code: ComponentType<PrimitiveProps> = createPrimitive("code");
export const Div: ComponentType<PrimitiveProps> = createPrimitive("div");
export const Em: ComponentType<PrimitiveProps> = createPrimitive("em");
export const Figcaption: ComponentType<PrimitiveProps> =
  createPrimitive("figcaption");
export const Figure: ComponentType<PrimitiveProps> = createPrimitive("figure");
export const Form: ComponentType<PrimitiveProps> = createPrimitive("form");
export const Footer: ComponentType<PrimitiveProps> = createPrimitive("footer");
export const H1: ComponentType<PrimitiveProps> = createPrimitive("h1");
export const H2: ComponentType<PrimitiveProps> = createPrimitive("h2");
export const H3: ComponentType<PrimitiveProps> = createPrimitive("h3");
export const H4: ComponentType<PrimitiveProps> = createPrimitive("h4");
export const H5: ComponentType<PrimitiveProps> = createPrimitive("h5");
export const H6: ComponentType<PrimitiveProps> = createPrimitive("h6");
export const Header: ComponentType<PrimitiveProps> = createPrimitive("header");
export const I: ComponentType<PrimitiveProps> = createPrimitive("i");
export const Img: ComponentType<PrimitiveProps> = createPrimitive("img");
export const Input: ComponentType<PrimitiveProps> = createPrimitive("input");
export const Label: ComponentType<PrimitiveProps> = createPrimitive("label");
export const Main: ComponentType<PrimitiveProps> = createPrimitive("main");
export const Nav: ComponentType<PrimitiveProps> = createPrimitive("nav");
export const P: ComponentType<PrimitiveProps> = createPrimitive("p");
export const Pre: ComponentType<PrimitiveProps> = createPrimitive("pre");
export const Section: ComponentType<PrimitiveProps> =
  createPrimitive("section");
export const Small: ComponentType<PrimitiveProps> = createPrimitive("small");
export const Span: ComponentType<PrimitiveProps> = createPrimitive("span");
export const Strong: ComponentType<PrimitiveProps> = createPrimitive("strong");
export const Textarea: ComponentType<PrimitiveProps> =
  createPrimitive("textarea");
