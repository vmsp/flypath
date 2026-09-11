import { Fragment } from "react";
import { jsx } from "react/jsx-runtime";
import { expect, test, vi } from "vitest";

import { runInMail } from "../../src/mail/context.ts";
import { serverIntrinsic } from "../../src/runtime/element-server.ts";
import { jsxDEV } from "../../src/runtime/jsx-dev-runtime.server.ts";
import { createJsxDevRuntime } from "../../src/runtime/jsx-factory.ts";
import type { JsxDevFn } from "../../src/runtime/jsx-factory.ts";
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
} from "../../src/runtime/jsx-runtime.server.ts";

test("development intrinsics preserve source, owner and static-child flags", () => {
  const create = vi.fn<JsxDevFn>((type, props, key, _static, _source, _self) =>
    jsx(type as never, props, key as string),
  );
  const runtime = createJsxDevRuntime(create, Fragment, serverIntrinsic);
  const source = { fileName: "page.tsx", lineNumber: 5 };
  const self = {};
  runtime(
    "div",
    { style: { color: { default: "red" } } },
    "page",
    false,
    source,
    self,
  );
  expect(
    create.mock.calls.map(([type, , , staticChildren]) => [
      type,
      staticChildren,
    ]),
  ).toEqual([
    ["div", false],
    ["style", false],
    [Fragment, true],
  ]);
  for (const call of create.mock.calls) {
    expect(call[4]).toBe(source);
    expect(call[5]).toBe(self);
  }
  create.mockClear();
  const Component = () => null;
  runtime(Component, {}, "component", true, source, self);
  expect(create).toHaveBeenCalledExactlyOnceWith(
    Component,
    {},
    "component",
    true,
    source,
    self,
  );
});

test.each([serverJsx, serverJsxs, jsxDEV])(
  "server JSX dispatches email intrinsics and rejects client references",
  (create) => {
    runInMail(
      { subject: undefined, baseUrl: "https://example.com", cids: new Set() },
      () => {
        expect(create("a", { href: "/post" }).props).toMatchObject({
          href: "https://example.com/post",
        });
        expect(() =>
          create({ $$typeof: Symbol.for("react.client.reference") }, {}),
        ).toThrow(/cannot be rendered into an email/);
      },
    );
    const Component = () => null;
    expect(create(Component, {}, "component").type).toBe(Component);
  },
);
