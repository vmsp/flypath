import type { ReactElement } from "react";

import { mailContext } from "../mail/context.ts";
import { isExternal } from "../router/href.ts";
import { ENV } from "../shared/env.ts";
import { emailStyle } from "../styles/email.ts";
import type { JsxFn } from "./element.ts";
import { styleElements } from "./element.ts";
import { isMetadata } from "./intrinsics.ts";

const DEV = process.env.NODE_ENV !== "production";

const DOCUMENT: ReadonlySet<string> = new Set(["html", "head", "body"]);

const CID = "cid:";

const CLIENT_REFERENCE = Symbol.for("react.client.reference");

export function assertNoClientReference(type: unknown): void {
  if (type === null || type === undefined) return;
  if (typeof type !== "object" && typeof type !== "function") return;
  if ((type as { $$typeof?: unknown })["$$typeof"] !== CLIENT_REFERENCE) return;
  const name = (type as { name?: unknown })["name"];
  throw new Error(
    `The "use client" component ${
      typeof name === "string" && name !== "" ? `<${name}> ` : ""
    }cannot render in email. Use a server component`,
  );
}

function absolute(
  tag: string,
  attribute: string,
  value: string,
  baseUrl: string | undefined,
): string {
  if (isExternal(value)) return value;
  if (baseUrl === undefined) {
    throw new Error(
      `<${tag} ${attribute}="${value}"> needs an absolute URL. Set mail.baseUrl in vite.config.ts, set ${ENV.url} in .env, or pass baseUrl to sendMail()`,
    );
  }
  return new URL(value, baseUrl).href;
}

function rewriteUrls(
  tag: string,
  props: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  const context = mailContext();
  const baseUrl = context?.baseUrl;

  if (tag === "a" && typeof props["href"] === "string") {
    next["href"] = absolute(tag, "href", props["href"], baseUrl);
  }

  if (tag !== "img" || typeof props["src"] !== "string") return;

  const src = props["src"];
  if (src.startsWith(CID)) {
    context?.cids.add(src.slice(CID.length));
    return;
  }
  next["src"] = absolute(tag, "src", src, baseUrl);
}

function mirrorAttributes(
  props: Record<string, unknown>,
  next: Record<string, unknown>,
  style: Record<string, string | number> | undefined,
): void {
  next["border"] = 0;
  for (const attribute of ["width", "height"] as const) {
    if (props[attribute] !== undefined) continue;
    const value = style?.[attribute];
    if (typeof value === "number") next[attribute] = value;
  }
  if (DEV && props["alt"] === undefined) {
    console.warn(
      `<img src="${String(
        props["src"] ?? "",
      )}"> in an email has no alt text. Add alt text for email clients that block images`,
    );
  }
}

export function createEmailIntrinsic(
  create: JsxFn,
  jsx: JsxFn,
  jsxs: JsxFn,
  fragment: unknown,
  type: string,
  props: Record<string, unknown>,
  key?: unknown,
): ReactElement {
  if (DOCUMENT.has(type)) {
    throw new Error(
      `<${type}> cannot render inside an email. The renderer creates the document and moves <title>, <meta> and <style> into <head>. Use sendMail({ html }) to supply the whole document`,
    );
  }
  if (isMetadata(type)) return create(type, props, key);

  const resolved = emailStyle(type, props["style"]);
  const next: Record<string, unknown> = { ...props };
  if (resolved.style === undefined) delete next["style"];
  else next["style"] = resolved.style;

  rewriteUrls(type, props, next);
  if (type === "img") mirrorAttributes(props, next, resolved.style);

  if (resolved.classes.length > 0) {
    const existing = props["className"];
    next["className"] = [
      typeof existing === "string" ? existing : undefined,
      ...resolved.classes,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const element = create(type, next, key);
  if (resolved.rules.length === 0) return element;

  return jsxs(
    fragment,
    {
      children: [...styleElements(jsx, resolved.rules, resolved), element],
    },
    key,
  );
}
