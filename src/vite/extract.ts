import MagicString from "magic-string";
import { parseSync } from "oxc-parser";

import type { AtomicRule } from "../styles/atomic.ts";
import { atomicRule } from "../styles/atomic.ts";
import { isConditionMap, validateConditionMap } from "../styles/conditions.ts";
import { isSupported } from "../styles/properties.ts";
import type { Scalar } from "../styles/shorthands.ts";
import { expandConditionMap } from "../styles/shorthands.ts";
import type { Node } from "./eval.ts";
import { evaluate, propertyKey, unwrap, walk } from "./eval.ts";
import type { Resolver } from "./tokens.ts";

export type Extraction = {
  code: string | undefined;
  rules: AtomicRule[];
};

function importScope(body: Node[], resolve: Resolver): Map<string, unknown> {
  const scope = new Map<string, unknown>();
  for (const statement of body) {
    if (statement["type"] !== "ImportDeclaration") continue;
    const source = String((statement["source"] as Node)["value"]);
    if (!source.endsWith(".css.ts")) continue;
    const module = resolve(source);
    if (!module) continue;
    for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
      const imported = specifier["imported"] as Node | undefined;
      if (!imported) continue;
      scope.set(
        String((specifier["local"] as Node)["name"]),
        module.exports[String(imported["name"])],
      );
    }
  }
  return scope;
}

function localScope(body: Node[], scope: Map<string, unknown>): void {
  for (const statement of body) {
    const declaration =
      statement["type"] === "ExportNamedDeclaration"
        ? (statement["declaration"] as Node | undefined)
        : statement;
    if (declaration?.["type"] !== "VariableDeclaration") continue;
    if (declaration["kind"] !== "const") continue;
    for (const declarator of declaration["declarations"] as Node[]) {
      const id = declarator["id"] as Node;
      const init = declarator["init"] as Node | undefined;
      if (id["type"] !== "Identifier" || !init) continue;
      try {
        scope.set(String(id["name"]), evaluate(init, scope));
      } catch {
        continue;
      }
    }
  }
}

export function extractStyles(
  id: string,
  code: string,
  resolve: Resolver,
): Extraction {
  const rules: AtomicRule[] = [];
  if (!code.includes("style")) return { code: undefined, rules };

  const { program, errors } = parseSync(id, code);
  if (errors.length > 0) return { code: undefined, rules };

  const body = (program as unknown as Node)["body"] as Node[];
  const scope = importScope(body, resolve);
  localScope(body, scope);

  const output = new MagicString(code);
  let changed = false;

  const objects: Node[] = [];
  walk(program, (node) => {
    if (node["type"] !== "JSXAttribute") return;
    const name = node["name"] as Node | undefined;
    if (!name || String(name["name"]) !== "style") return;
    const value = node["value"] as Node | undefined;
    if (!value || value["type"] !== "JSXExpressionContainer") return;
    const expression = unwrap(value["expression"] as Node);
    if (expression["type"] === "ObjectExpression") objects.push(expression);
    if (expression["type"] === "ArrayExpression") {
      for (const element of expression["elements"] as Node[]) {
        const item = unwrap(element);
        if (item["type"] === "ObjectExpression") objects.push(item);
      }
    }
  });

  for (const object of objects) {
    for (const property of object["properties"] as Node[]) {
      if (property["type"] !== "Property") continue;
      const valueNode = unwrap(property["value"] as Node);
      if (valueNode["type"] !== "ObjectExpression") continue;

      let key: string;
      try {
        key = propertyKey(property);
      } catch {
        continue;
      }
      if (key.startsWith("--")) continue;

      let value: unknown;
      try {
        value = evaluate(valueNode, scope);
      } catch {
        continue;
      }
      if (!isConditionMap(value)) continue;
      if (!isSupported(key)) {
        throw new Error(`flypath: unsupported style property "${key}"`);
      }
      validateConditionMap(key, value);

      const classes: Record<string, string> = {};
      for (const [longhand, map] of expandConditionMap(
        key,
        value as Record<string, Scalar>,
      )) {
        const rule = atomicRule(longhand, map);
        rules.push(rule);
        classes[longhand] = rule.className;
      }

      output.update(
        valueNode["start"] as number,
        valueNode["end"] as number,
        JSON.stringify({ $c: classes, $v: value }),
      );
      changed = true;
    }
  }

  return { code: changed ? output.toString() : undefined, rules };
}
