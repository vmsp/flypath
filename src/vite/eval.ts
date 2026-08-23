export type Node = Record<string, unknown>;

export class StaticError extends Error {
  readonly start: number;

  constructor(message: string, node: Node | undefined) {
    super(message);
    this.start =
      typeof node?.["start"] === "number" ? (node["start"] as number) : 0;
  }
}

const UNWRAP = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ParenthesizedExpression",
]);

export function unwrap(node: Node): Node {
  let current = node;
  while (UNWRAP.has(String(current["type"]))) {
    current = current["expression"] as Node;
  }
  return current;
}

export function propertyKey(property: Node): string {
  const key = property["key"] as Node;
  if (property["computed"] === true) {
    return String(evaluate(key, new Map()));
  }
  if (key["type"] === "Identifier") return String(key["name"]);
  return String(key["value"]);
}

export function evaluate(input: Node, scope: Map<string, unknown>): unknown {
  const node = unwrap(input);
  switch (node["type"]) {
    case "Literal":
      return node["value"];
    case "Identifier": {
      const name = String(node["name"]);
      if (!scope.has(name)) {
        throw new StaticError(
          `flypath: "${name}" is not statically known here`,
          node,
        );
      }
      return scope.get(name);
    }
    case "UnaryExpression": {
      const value = evaluate(node["argument"] as Node, scope);
      if (node["operator"] === "-") return -Number(value);
      if (node["operator"] === "+") return Number(value);
      throw new StaticError("flypath: unsupported operator", node);
    }
    case "BinaryExpression": {
      const left = evaluate(node["left"] as Node, scope);
      const right = evaluate(node["right"] as Node, scope);
      switch (node["operator"]) {
        case "+":
          return typeof left === "string" || typeof right === "string"
            ? `${String(left)}${String(right)}`
            : Number(left) + Number(right);
        case "-":
          return Number(left) - Number(right);
        case "*":
          return Number(left) * Number(right);
        case "/":
          return Number(left) / Number(right);
        default:
          throw new StaticError("flypath: unsupported operator", node);
      }
    }
    case "TemplateLiteral": {
      const quasis = node["quasis"] as Node[];
      const expressions = node["expressions"] as Node[];
      let out = "";
      for (const [index, quasi] of quasis.entries()) {
        out += String((quasi["value"] as { cooked?: string }).cooked ?? "");
        const expression = expressions[index];
        if (expression) out += String(evaluate(expression, scope));
      }
      return out;
    }
    case "ArrayExpression":
      return (node["elements"] as Node[]).map((element) =>
        evaluate(element, scope),
      );
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const property of node["properties"] as Node[]) {
        if (property["type"] === "SpreadElement") {
          Object.assign(
            out,
            evaluate(property["argument"] as Node, scope) as object,
          );
          continue;
        }
        out[propertyKey(property)] = evaluate(property["value"] as Node, scope);
      }
      return out;
    }
    case "MemberExpression": {
      const object = evaluate(node["object"] as Node, scope) as Record<
        string,
        unknown
      >;
      const property = node["property"] as Node;
      const key =
        node["computed"] === true
          ? String(evaluate(property, scope))
          : String(property["name"]);
      if (object === null || typeof object !== "object" || !(key in object)) {
        throw new StaticError(
          `flypath: "${key}" is not statically known here`,
          node,
        );
      }
      return object[key];
    }
    default:
      throw new StaticError(
        `flypath: ${String(node["type"])} cannot be evaluated at build time`,
        node,
      );
  }
}

export function walk(node: unknown, visit: (node: Node) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const record = node as Node;
  if (typeof record["type"] === "string") visit(record);
  for (const key of Object.keys(record)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walk(record[key], visit);
  }
}
