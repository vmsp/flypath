import { parseSync } from "oxc-parser";

import type { FlatRoute, Flattened } from "../router/flatten.ts";
import { flatten, hasChrome, matchRoutes } from "../router/flatten.ts";
import type { ManifestRoute, RouteManifest } from "../router/manifest.ts";
import type { Middleware, Next } from "../router/middleware.ts";
import type {
  AnyNode,
  Loader,
  RouteOptions,
  RouteTree,
} from "../router/types.ts";
import { FLIGHT_SUFFIX } from "../shared/flight.ts";
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

const origins = new WeakMap<Middleware, string>();

function placeholder(name: string, origin: string): Middleware {
  const value = { [name]: (next: Next) => next() }[name] as Middleware;
  origins.set(value, origin);
  return value;
}

function guards(node: Node | undefined, origin: string): Middleware[] {
  if (!node) return [];
  const value = unwrap(node);
  if (value["type"] !== "ObjectExpression") return [];

  for (const property of value["properties"] as Node[]) {
    if (property["type"] === "SpreadElement") continue;
    if (propertyKey(property) !== "middleware") continue;
    const list = unwrap(property["value"] as Node);
    if (list["type"] !== "ArrayExpression") return [];
    return (list["elements"] as Node[]).map((element, at) => {
      const entry = unwrap(element);
      return placeholder(
        entry["type"] === "Identifier"
          ? String(entry["name"])
          : `middleware${String(at)}`,
        origin,
      );
    });
  }
  return [];
}

function launchOption(
  node: Node | undefined,
  context: Context,
): string | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  if (value["type"] !== "ObjectExpression") return undefined;

  for (const property of value["properties"] as Node[]) {
    if (property["type"] === "SpreadElement") continue;
    if (propertyKey(property) !== "launch") continue;
    const launch = evaluate(property["value"] as Node, context.scope);
    if (typeof launch !== "string") {
      throw new StaticError(
        "flypath: routes() launch is read at build time and shipped to the " +
          "client, so it must be a string literal",
        property,
      );
    }
    return launch;
  }
  return undefined;
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
      return {
        kind: "index",
        load: NOOP,
        options: options(args[1], context),
        middleware: guards(args[1], "index()"),
      };
    case "notFound":
      return {
        kind: "not-found",
        load: NOOP,
        options: options(args[1], context),
        middleware: guards(args[1], "notFound()"),
      };
    case "layout":
      return {
        kind: "layout",
        load: NOOP,
        middleware: guards(
          hasOptions(args, 1) ? args[1] : undefined,
          "layout()",
        ),
        children: children(args[hasOptions(args, 1) ? 2 : 1], context),
      };
    case "stack":
      return {
        kind: "stack",
        middleware: guards(
          hasOptions(args, 0) ? args[0] : undefined,
          "stack()",
        ),
        children: children(args[hasOptions(args, 0) ? 1 : 0], context),
      };
    case "branches":
      return {
        kind: "branches",
        load: NOOP,
        middleware: guards(
          hasOptions(args, 1) ? args[1] : undefined,
          "branches()",
        ),
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
        middleware: guards(args[2], `route("${pattern}")`),
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
  const root = hasOptions(args, 0) ? args[0] : undefined;
  const launch = launchOption(root, context);

  return {
    kind: "routes",
    ...(launch === undefined ? {} : { launch }),
    middleware: guards(root, "routes()"),
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

function checkRoute(route: FlatRoute): void {
  if (route.options.prerender !== true) return;
  const at = route.pattern;

  if (at.split("/").some((part) => part.startsWith(":"))) {
    throw new Error(
      `flypath: ${at} has prerender: true but its pattern takes a param; a ` +
        "prerendered route is rendered once at build time and there is " +
        "nowhere yet to declare the values to render it for — drop prerender",
    );
  }

  const guard = route.middleware[0];
  if (guard) {
    throw new Error(
      `flypath: ${at} has prerender: true but the middleware ${guard.name}() ` +
        `runs over it (declared on ${origins.get(guard) ?? "an ancestor"}); a ` +
        "middleware exists to make a response depend on the request, and a " +
        "prerendered response is a file — move the route out from under it, " +
        "or drop prerender",
    );
  }

  if (route.options.presentation === "modal") {
    throw new Error(
      `flypath: ${at} has prerender: true and presentation: "modal"; a modal ` +
        "is fetched as a container-scoped payload and a prerendered route is " +
        "one file, so it cannot be both — drop one of the two",
    );
  }

  for (const part of at.split("/")) {
    if (part === "index") {
      throw new Error(
        `flypath: ${at} has prerender: true but a path segment is "index"; ` +
          "the page is written to <path>/index.html, so the segment would " +
          "collide with the file — rename it",
      );
    }
    if (part.endsWith(FLIGHT_SUFFIX)) {
      throw new Error(
        `flypath: ${at} has prerender: true but a path segment ends in ` +
          `"${FLIGHT_SUFFIX}"; that is the URL a route's payload is fetched ` +
          "from, so the segment would collide with it — rename it",
      );
    }
  }
}

const BUILT_FOR_THE_BROWSER =
  "a prerendered page is built for the browser and rendered once for " +
  "everyone, which is not what an app opens on";

function checkLaunch(tree: RouteTree, routes: readonly FlatRoute[]): void {
  const { launch } = tree;

  if (launch === undefined) {
    if (matchRoutes(routes, "/")?.route.options.prerender !== true) return;
    throw new Error(
      "flypath: / is prerendered but routes() declares no launch, so the app " +
        `would open on it; ${BUILT_FOR_THE_BROWSER} — set launch to the ` +
        "route the app opens on",
    );
  }

  if (launch.split("/").some((part) => part.startsWith(":"))) {
    throw new Error(
      `flypath: routes({ launch: "${launch}" }) takes a param; the app opens ` +
        "on it with no request to fill one from, so it must be a complete " +
        "path — write the value into it",
    );
  }

  const matched = matchRoutes(routes, launch);
  if (!matched) {
    throw new Error(
      `flypath: routes({ launch: "${launch}" }) matches no route; launch is ` +
        "the path the native app opens on, so it must be one this tree " +
        "declares",
    );
  }

  if (matched.route.options.prerender === true) {
    throw new Error(
      `flypath: routes({ launch: "${launch}" }) names a prerendered route; ` +
        `${BUILT_FOR_THE_BROWSER} — point launch at a route the app renders ` +
        "on demand, or drop prerender from it",
    );
  }
}

function check(tree: RouteTree, flat: Flattened): void {
  for (const route of flat.routes) checkRoute(route);

  if (flat.fallback?.options.prerender === true) {
    throw new Error(
      "flypath: notFound() has prerender: true; the fallback has no path of " +
        "its own, so there is no file to write it to and no URL for the " +
        "client to ask for — drop prerender",
    );
  }

  checkLaunch(tree, flat.routes);
}

export function routeManifest(tree: RouteTree): RouteManifest {
  const flat = flatten(tree);
  check(tree, flat);

  const { routes, fallback, containers } = flat;

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
    ...(tree.launch === undefined ? {} : { launch: tree.launch }),
  };
}
