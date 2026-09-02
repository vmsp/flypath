import { parseSync } from "oxc-parser";

import type { FlatRoute } from "../router/flatten.ts";
import { flatten, hasChrome } from "../router/flatten.ts";
import type { ManifestRoute, RouteManifest } from "../router/manifest.ts";
import type {
  AnyNode,
  Loader,
  RouteOptions,
  RouteTree,
} from "../router/types.ts";
import type { Node } from "./eval.ts";
import { evaluate, propertyKey, StaticError, unwrap } from "./eval.ts";

const BUILDERS = new Set([
  "routes",
  "route",
  "index",
  "notFound",
  "layout",
  "stack",
  "branches",
]);

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

const SERVER_ONLY = new Set(["middleware"]);

function omitted(value: unknown): RouteOptions {
  const out = { ...(value as Record<string, unknown>) };
  for (const key of SERVER_ONLY) delete out[key];
  return out as RouteOptions;
}

function options(node: Node | undefined, context: Context): RouteOptions {
  if (!node) return {};
  const value = unwrap(node);

  if (value["type"] !== "ObjectExpression") {
    const evaluated = evaluate(value, context.scope);
    if (evaluated === null || typeof evaluated !== "object") {
      throw new StaticError("flypath: route options must be an object", value);
    }
    return omitted(evaluated);
  }

  const out: Record<string, unknown> = {};
  for (const property of value["properties"] as Node[]) {
    if (property["type"] === "SpreadElement") {
      const spread = evaluate(property["argument"] as Node, context.scope);
      Object.assign(out, omitted(spread));
      continue;
    }
    const key = propertyKey(property);
    if (SERVER_ONLY.has(key)) continue;
    try {
      out[key] = evaluate(property["value"] as Node, context.scope);
    } catch (error) {
      if (!(error instanceof StaticError)) throw error;
      throw new StaticError(
        `flypath: route option "${key}" is read at build time and shipped to ` +
          'the client, so it must be a literal; only "middleware" may hold ' +
          "functions and other runtime values",
        property,
      );
    }
  }
  return out as RouteOptions;
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

function hasOptions(args: readonly Node[], at: number): boolean {
  const node = args[at];
  if (node === undefined) return false;
  const type = unwrap(node)["type"];
  if (type === "ObjectExpression") return true;
  return type !== "ArrayExpression" && args[at + 1] !== undefined;
}

function interpret(input: Node, context: Context): AnyNode {
  const node = resolveExpression(input, context);
  const builder = builderOf(node, context);
  const args = (node["arguments"] as Node[] | undefined) ?? [];

  switch (builder) {
    case "index":
      return { kind: "index", load: NOOP, options: options(args[1], context) };
    case "notFound":
      return {
        kind: "not-found",
        load: NOOP,
        options: options(args[1], context),
      };
    case "layout":
      return {
        kind: "layout",
        load: NOOP,
        children: children(args[hasOptions(args, 1) ? 2 : 1], context),
      };
    case "stack":
      return {
        kind: "stack",
        children: children(args[hasOptions(args, 0) ? 1 : 0], context),
      };
    case "branches":
      return {
        kind: "branches",
        load: NOOP,
        children: children(args[hasOptions(args, 1) ? 2 : 1], context),
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

  const args = node["arguments"] as Node[];

  return {
    kind: "routes",
    children: children(args[hasOptions(args, 0) ? 1 : 0], context),
  };
}

function manifestRoute(route: FlatRoute): ManifestRoute {
  return {
    id: route.id,
    pattern: route.pattern,
    options: route.options,
    placement: [...route.placement],
  };
}

export function routeManifest(tree: RouteTree): RouteManifest {
  const { routes, fallback, containers } = flatten(tree);

  return {
    routes: routes.map(manifestRoute),
    ...(fallback === undefined ? {} : { fallback: manifestRoute(fallback) }),
    containers: [...containers.values()].map((container) => ({
      id: container.id,
      kind: container.kind,
      ...(container.parent === undefined ? {} : { parent: container.parent }),
      branches: [...container.branches],
      root: container.root,
      chrome: hasChrome(containers, container),
    })),
  };
}
