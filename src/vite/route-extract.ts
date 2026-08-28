import { parseSync } from "oxc-parser";

import { flatten, ROOT_BOUNDARY } from "../router/flatten.ts";
import type { RouteManifest } from "../router/manifest.ts";
import type {
  AnyNode,
  Loader,
  RouteOptions,
  RouteTree,
} from "../router/types.ts";
import type { Node } from "./eval.ts";
import { evaluate, StaticError, unwrap } from "./eval.ts";

const BUILDERS = new Set(["routes", "route", "index", "layout", "tabs"]);

const NOOP: Loader = () =>
  Promise.reject(new Error("flypath: route loaders are server-only"));

function scopeOf(body: Node[]): Map<string, unknown> {
  const scope = new Map<string, unknown>();
  for (const statement of body) {
    const declaration =
      statement["type"] === "ExportNamedDeclaration"
        ? (statement["declaration"] as Node | undefined)
        : statement;
    if (declaration?.["type"] !== "VariableDeclaration") continue;
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
  return scope;
}

function builderNames(body: Node[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of body) {
    if (statement["type"] !== "ImportDeclaration") continue;
    const source = String((statement["source"] as Node)["value"]);
    if (source !== "flypath/router") continue;
    for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
      const imported = specifier["imported"] as Node | undefined;
      if (!imported) continue;
      const name = String(imported["name"]);
      if (!BUILDERS.has(name)) continue;
      names.set(String((specifier["local"] as Node)["name"]), name);
    }
  }
  return names;
}

function declarations(body: Node[]): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const statement of body) {
    const declaration =
      statement["type"] === "ExportNamedDeclaration"
        ? (statement["declaration"] as Node | undefined)
        : statement;
    if (declaration?.["type"] !== "VariableDeclaration") continue;
    for (const declarator of declaration["declarations"] as Node[]) {
      const id = declarator["id"] as Node;
      const init = declarator["init"] as Node | undefined;
      if (id["type"] !== "Identifier" || !init) continue;
      out.set(String(id["name"]), init);
    }
  }
  return out;
}

function defaultExport(body: Node[]): Node | undefined {
  for (const statement of body) {
    if (statement["type"] !== "ExportDefaultDeclaration") continue;
    return statement["declaration"] as Node;
  }
  return undefined;
}

type Context = {
  builders: Map<string, string>;
  locals: Map<string, Node>;
  scope: Map<string, unknown>;
};

function resolveExpression(node: Node, context: Context): Node {
  const value = unwrap(node);
  if (value["type"] !== "Identifier") return value;
  const local = context.locals.get(String(value["name"]));
  if (!local) return value;
  return resolveExpression(local, context);
}

function builderOf(node: Node, context: Context): string | undefined {
  if (node["type"] !== "CallExpression") return undefined;
  const callee = unwrap(node["callee"] as Node);
  if (callee["type"] !== "Identifier") return undefined;
  return context.builders.get(String(callee["name"]));
}

function options(node: Node | undefined, context: Context): RouteOptions {
  if (!node) return {};
  const value = evaluate(node, context.scope);
  if (value === null || typeof value !== "object") {
    throw new StaticError("flypath: route options must be an object", node);
  }
  return value as RouteOptions;
}

function children(node: Node | undefined, context: Context): AnyNode[] {
  if (!node) return [];
  const value = unwrap(node);
  if (value["type"] !== "ArrayExpression") {
    throw new StaticError(
      "flypath: route children must be an inline array literal",
      value,
    );
  }
  return (value["elements"] as Node[]).map((element) =>
    interpret(element, context),
  );
}

function interpret(input: Node, context: Context): AnyNode {
  const node = resolveExpression(input, context);
  const builder = builderOf(node, context);
  const args = (node["arguments"] as Node[] | undefined) ?? [];

  switch (builder) {
    case "index":
      return { kind: "index", load: NOOP, options: options(args[1], context) };
    case "layout":
      return {
        kind: "layout",
        load: NOOP,
        children: children(args[1], context),
      };
    case "tabs":
      return {
        kind: "tabs",
        load: NOOP,
        options: options(args[2], context),
        children: children(args[1], context),
      };
    case "route": {
      const pattern = evaluate(args[0] as Node, context.scope);
      if (typeof pattern !== "string") {
        throw new StaticError("flypath: route patterns must be strings", node);
      }
      return {
        kind: "route",
        pattern,
        load: NOOP,
        options: options(args[2], context),
        children: children(args[3], context),
      };
    }
    default:
      throw new StaticError(
        'flypath: routes may only be built with the "flypath/router" builders',
        node,
      );
  }
}

export function parseRouteTree(id: string, code: string): RouteTree {
  const { program, errors } = parseSync(id, code);
  if (errors.length > 0) {
    throw new Error(`flypath: could not parse ${id}\n${errors[0]?.message}`);
  }

  const body = (program as unknown as Node)["body"] as Node[];
  const context: Context = {
    builders: builderNames(body),
    locals: declarations(body),
    scope: scopeOf(body),
  };

  const exported = defaultExport(body);
  if (!exported) {
    throw new Error(`flypath: ${id} must export the route tree as default`);
  }

  const node = resolveExpression(exported, context);
  if (builderOf(node, context) !== "routes") {
    throw new Error(`flypath: ${id} must default-export routes([...])`);
  }

  return {
    kind: "routes",
    children: children((node["arguments"] as Node[])[0], context),
  };
}

export function routeManifest(tree: RouteTree): RouteManifest {
  const { routes, boundaries } = flatten(tree);
  const navigator =
    [...boundaries.keys()].find((id) => id !== ROOT_BOUNDARY) ?? ROOT_BOUNDARY;

  return {
    routes: routes.map((route) => ({
      id: route.id,
      pattern: route.pattern,
      options: route.options,
      boundary: route.boundary,
      ...(route.tab === undefined ? {} : { tab: route.tab }),
    })),
    boundaries: [...boundaries.values()].map((boundary) => ({
      id: boundary.id,
      tabs: boundary.tabs.map((tab) => ({ ...tab })),
    })),
    navigator,
  };
}
