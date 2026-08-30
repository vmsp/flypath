import MagicString from "magic-string";
import { parseSync } from "oxc-parser";

import { isMedia } from "../styles/conditions.ts";
import { hash } from "../styles/hash.ts";
import { isSupported } from "../styles/properties.ts";
import type { Frames } from "../styles/registry.ts";
import { cssValue } from "../styles/serialize.ts";
import type { Scalar } from "../styles/shorthands.ts";
import { expandProperty } from "../styles/shorthands.ts";
import type { Node } from "./eval.ts";
import { evaluate, StaticError, unwrap } from "./eval.ts";

type VarValue = Scalar | Record<string, Scalar>;

export type Compiled = {
  code: string;
  css: string;
  exports: Record<string, unknown>;
  vars: Record<string, VarValue>;
  keyframes: Record<string, Frames>;
};

export type Resolver = (source: string) => Compiled | undefined;

function varName(relative: string, binding: string, key: string): string {
  return `--${key}-${hash(`${relative}:${binding}:${key}`)}`;
}

function token(name: string, value: VarValue): string {
  const fallback = typeof value === "object" ? value["default"] : value;
  return fallback === undefined
    ? `var(${name})`
    : `var(${name}, ${String(fallback)})`;
}

function compileVars(
  relative: string,
  binding: string,
  argument: unknown,
  vars: Record<string, VarValue>,
): Record<string, string> {
  const input = argument as Record<string, VarValue>;
  const exported: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const name = varName(relative, binding, key);
    if (typeof value === "object") {
      for (const condition of Object.keys(value)) {
        if (condition !== "default" && !isMedia(condition)) {
          throw new Error(
            `flypath: css.vars only supports "@media" conditions, got "${condition}"`,
          );
        }
      }
    }
    vars[name] = value;
    exported[key] = token(name, value);
  }
  return exported;
}

const TOKEN = /^var\((--[\w-]+)/;

function compileOverride(
  argument: unknown,
  values: unknown,
): Record<string, Scalar> {
  const tokens = argument as Record<string, string>;
  const out: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(values as Record<string, Scalar>)) {
    const reference = tokens[key];
    const match = reference === undefined ? null : TOKEN.exec(reference);
    if (!match) {
      throw new Error(`flypath: css.override got an unknown token "${key}"`);
    }
    if (typeof value === "object") {
      throw new Error(
        `flypath: css.override values must be scalars, got a condition map for "${key}"`,
      );
    }
    out[match[1] as string] = value;
  }
  return out;
}

function compileKeyframes(
  relative: string,
  binding: string,
  argument: unknown,
  keyframes: Record<string, Frames>,
): string {
  const name = `kf-${hash(`${relative}:${binding}`)}`;
  const frames: Frames = {};
  for (const [offset, style] of Object.entries(
    argument as Record<string, Record<string, Scalar>>,
  )) {
    const expanded: Record<string, Scalar> = {};
    for (const [property, value] of Object.entries(style)) {
      if (!isSupported(property)) {
        throw new Error(
          `flypath: unsupported keyframe property "${property}" in "${binding}"`,
        );
      }
      for (const [longhand, next] of expandProperty(property, value)) {
        expanded[longhand] = next;
      }
    }
    frames[offset] = expanded;
  }
  keyframes[name] = frames;
  return name;
}

function emitCss(
  vars: Record<string, VarValue>,
  keyframes: Record<string, Frames>,
): string {
  const root: string[] = [];
  const media = new Map<string, string[]>();

  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== "object") {
      root.push(`  ${name}: ${String(value)};`);
      continue;
    }
    for (const [condition, next] of Object.entries(value)) {
      if (condition === "default") {
        root.push(`  ${name}: ${String(next)};`);
        continue;
      }
      const bucket = media.get(condition) ?? [];
      bucket.push(`    ${name}: ${String(next)};`);
      media.set(condition, bucket);
    }
  }

  const parts: string[] = [];
  if (root.length > 0) parts.push(`:root {\n${root.join("\n")}\n}`);
  for (const [condition, declarations] of media) {
    parts.push(`${condition} {\n  :root {\n${declarations.join("\n")}\n  }\n}`);
  }
  for (const [name, frames] of Object.entries(keyframes)) {
    const blocks = Object.entries(frames).map(([offset, style]) => {
      const declarations = Object.entries(style)
        .map(
          ([property, value]) =>
            `      ${property.replace(
              /[A-Z]/g,
              (ch) => `-${ch.toLowerCase()}`,
            )}: ${cssValue(property, value)};`,
        )
        .join("\n");
      return `  ${offset} {\n${declarations}\n  }`;
    });
    parts.push(`@keyframes ${name} {\n${blocks.join("\n")}\n}`);
  }
  return parts.join("\n\n");
}

export function compileTokens(
  id: string,
  code: string,
  relative: string,
  resolve: Resolver,
): Compiled {
  const { program, errors } = parseSync(id, code);
  if (errors.length > 0) {
    throw new Error(
      `flypath: failed to parse ${relative}: ${errors[0]?.message}`,
    );
  }

  const output = new MagicString(code);
  const scope = new Map<string, unknown>();
  const exports: Record<string, unknown> = {};
  const vars: Record<string, VarValue> = {};
  const keyframes: Record<string, Frames> = {};
  let cssBinding: string | undefined;

  const body = (program as unknown as Node)["body"] as Node[];

  for (const statement of body) {
    if (statement["type"] !== "ImportDeclaration") continue;
    const source = String((statement["source"] as Node)["value"]);
    const specifiers = (statement["specifiers"] as Node[] | undefined) ?? [];

    if (source === "flypath") {
      for (const specifier of specifiers) {
        const imported = specifier["imported"] as Node | undefined;
        if (imported && String(imported["name"]) === "css") {
          cssBinding = String((specifier["local"] as Node)["name"]);
        }
      }
      if (cssBinding !== undefined) {
        output.remove(statement["start"] as number, statement["end"] as number);
      }
      continue;
    }

    if (!source.endsWith(".css.ts")) continue;
    const module = resolve(source);
    if (!module) continue;
    for (const specifier of specifiers) {
      const imported = specifier["imported"] as Node | undefined;
      if (!imported) continue;
      scope.set(
        String((specifier["local"] as Node)["name"]),
        module.exports[String(imported["name"])],
      );
    }
  }

  const compileCall = (binding: string, call: Node): unknown => {
    const callee = call["callee"] as Node;
    if (callee["type"] !== "MemberExpression") return undefined;
    const object = callee["object"] as Node;
    if (
      object["type"] !== "Identifier" ||
      String(object["name"]) !== cssBinding
    ) {
      return undefined;
    }
    const method = String((callee["property"] as Node)["name"]);
    const args = (call["arguments"] as Node[] | undefined) ?? [];

    if (method === "vars") {
      const value = evaluate(args[0] as Node, scope);
      return compileVars(relative, binding, value, vars);
    }
    if (method === "keyframes") {
      const value = evaluate(args[0] as Node, scope);
      return compileKeyframes(relative, binding, value, keyframes);
    }
    if (method === "override") {
      const tokens = evaluate(args[0] as Node, scope);
      const values = evaluate(args[1] as Node, scope);
      return compileOverride(tokens, values);
    }
    throw new Error(`flypath: unknown css.${method}()`);
  };

  const declare = (declaration: Node, isExport: boolean): void => {
    if (declaration["type"] !== "VariableDeclaration") return;
    for (const declarator of declaration["declarations"] as Node[]) {
      const id = declarator["id"] as Node;
      if (id["type"] !== "Identifier") continue;
      const init = declarator["init"] as Node | undefined;
      if (!init) continue;
      const name = String(id["name"]);
      const expression = unwrap(init);

      let value: unknown;
      if (expression["type"] === "CallExpression" && cssBinding !== undefined) {
        value = compileCall(name, expression);
        if (value !== undefined) {
          output.update(
            expression["start"] as number,
            expression["end"] as number,
            JSON.stringify(value),
          );
        }
      }
      if (value === undefined) {
        try {
          value = evaluate(expression, scope);
        } catch {
          continue;
        }
      }
      scope.set(name, value);
      if (isExport) exports[name] = value;
    }
  };

  for (const statement of body) {
    if (statement["type"] === "VariableDeclaration") {
      declare(statement, false);
    } else if (statement["type"] === "ExportNamedDeclaration") {
      const declaration = statement["declaration"] as Node | undefined;
      if (declaration) declare(declaration, true);
    }
  }

  return {
    code: output.toString(),
    css: emitCss(vars, keyframes),
    exports,
    vars,
    keyframes,
  };
}

export function diagnostic(error: unknown, relative: string): Error {
  if (error instanceof StaticError) {
    return new Error(`${error.message} (${relative})`);
  }
  return error instanceof Error
    ? new Error(`${error.message} (${relative})`)
    : new Error(`${String(error)} (${relative})`);
}
