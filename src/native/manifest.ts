import fs from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";

import { hash } from "../styles/hash.ts";
import { walk } from "../vite/eval.ts";

export type NativeType =
  | { kind: "void" }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "bytes" }
  | { kind: "array"; element: NativeType }
  | { kind: "optional"; value: NativeType }
  | { kind: "struct"; name: string }
  | { kind: "enum"; name: string };

export type NativeParam = { name: string; type: NativeType };

export type NativeFunction = {
  name: string;
  params: NativeParam[];
  result: NativeType;
  async: boolean;
};

export type NativeEvent = { name: string; params: NativeParam[] };

export type NativeComponentEntry = {
  name: string;
  props: NativeParam[];
  events: NativeEvent[];
};

export type NativeStruct = { name: string; fields: NativeParam[] };

export type NativeEnum = { name: string; values: string[] };

export type NativeInline = {
  name: string;
  start: number;
  end: number;
};

export type NativeModuleEntry = {
  id: string;
  file: string;
  source: string;
  slug: string;
  functions: NativeFunction[];
  components: NativeComponentEntry[];
  structs: NativeStruct[];
  enums: NativeEnum[];
  base: string;
  inline: NativeInline[];
  web: string | undefined;
  cpp: string | undefined;
};

export type NativeManifest = {
  hash: string;
  modules: NativeModuleEntry[];
};

export const DIRECTIVE = "use native";

type Node = Record<string, unknown>;

const SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "android",
  "apple",
  "cpp",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const WEB_EXTENSIONS = [".web.tsx", ".web.ts", ".web.jsx", ".web.js"];

const COMPONENT_TYPES = new Set(["NativeComponent", "ComponentType"]);

export class ManifestError extends Error {
  readonly file: string;
  readonly start: number;

  constructor(message: string, file: string, node: Node | undefined) {
    super(message);
    this.file = file;
    this.start = typeof node?.["start"] === "number" ? node["start"] : 0;
  }
}

function scan(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      scan(path.join(dir, entry.name), out);
      continue;
    }
    const extension = SOURCE_EXTENSIONS.find((value) =>
      entry.name.endsWith(value),
    );
    if (!extension) continue;
    if (WEB_EXTENSIONS.some((value) => entry.name.endsWith(value))) continue;
    out.push(path.join(dir, entry.name));
  }
}

export function hasDirective(code: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use native["']/.test(
    code,
  );
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

export function slugFor(source: string): string {
  return source.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9]+/g, "_");
}

function pascal(value: string): string {
  return value.replace(/(^|_)([a-z])/g, (_, __, letter: string) =>
    letter.toUpperCase(),
  );
}

export function componentName(slug: string, name: string): string {
  return `Flypath_${slug}_${name}`;
}

export function symbolFor(slug: string, name: string): string {
  return `flypath_${slug}_${name}`;
}

export function viewSymbolFor(slug: string, name: string): string {
  return `flypath_view_${slug}_${name}`;
}

export function eventType(name: string): string {
  const base = name.startsWith("on") ? name.slice(2) : name;
  return `top${base[0]?.toUpperCase() ?? ""}${base.slice(1)}`;
}

export function typeName(slug: string, name: string): string {
  return `${pascal(slug)}${name}`;
}

type Names = { structs: Set<string>; enums: Set<string> };

function annotationOf(node: Node | undefined): Node | undefined {
  const annotation = node?.["typeAnnotation"] as Node | undefined;
  return annotation?.["typeAnnotation"] as Node | undefined;
}

function returnTypeOf(node: Node | undefined): Node | undefined {
  const annotation = node?.["returnType"] as Node | undefined;
  return annotation?.["typeAnnotation"] as Node | undefined;
}

function readType(
  node: Node | undefined,
  file: string,
  names: Names,
  where: string,
): NativeType {
  if (!node) {
    throw new ManifestError(
      `flypath: ${where} needs an explicit type annotation`,
      file,
      node,
    );
  }
  const type = String(node["type"]);
  switch (type) {
    case "TSVoidKeyword":
    case "TSUndefinedKeyword":
      return { kind: "void" };
    case "TSBooleanKeyword":
      return { kind: "boolean" };
    case "TSNumberKeyword":
      return { kind: "number" };
    case "TSStringKeyword":
      return { kind: "string" };
    case "TSArrayType":
      return {
        kind: "array",
        element: readType(node["elementType"] as Node, file, names, where),
      };
    case "TSUnionType": {
      const members = (node["types"] as Node[]) ?? [];
      const rest = members.filter(
        (member) =>
          member["type"] !== "TSUndefinedKeyword" &&
          member["type"] !== "TSNullKeyword",
      );
      if (rest.length === members.length || rest.length !== 1) {
        throw new ManifestError(
          `flypath: ${where} uses a union type that is not "T | undefined" — ` +
            "declare a named type alias for literal unions",
          file,
          node,
        );
      }
      return {
        kind: "optional",
        value: readType(rest[0] as Node, file, names, where),
      };
    }
    case "TSTypeReference": {
      const name = String((node["typeName"] as Node)["name"] ?? "");
      if (name === "ArrayBuffer") return { kind: "bytes" };
      if (name === "Array") {
        const args = (node["typeArguments"] as Node | undefined)?.["params"] as
          | Node[]
          | undefined;
        return {
          kind: "array",
          element: readType(args?.[0], file, names, where),
        };
      }
      if (names.structs.has(name)) return { kind: "struct", name };
      if (names.enums.has(name)) return { kind: "enum", name };
      throw new ManifestError(
        `flypath: ${where} uses "${name}", which is outside the "use native" type lattice`,
        file,
        node,
      );
    }
    default:
      throw new ManifestError(
        `flypath: ${where} uses a type that is outside the "use native" type lattice`,
        file,
        node,
      );
  }
}

function readResult(
  node: Node | undefined,
  file: string,
  names: Names,
  where: string,
): { result: NativeType; async: boolean } {
  if (
    node?.["type"] === "TSTypeReference" &&
    String((node["typeName"] as Node)["name"] ?? "") === "Promise"
  ) {
    const args = (node["typeArguments"] as Node | undefined)?.["params"] as
      | Node[]
      | undefined;
    return {
      result: readType(args?.[0], file, names, where),
      async: true,
    };
  }
  return { result: readType(node, file, names, where), async: false };
}

function readParams(
  params: Node[],
  file: string,
  names: Names,
  where: string,
): NativeParam[] {
  return params.map((param): NativeParam => {
    if (param["type"] !== "Identifier") {
      throw new ManifestError(
        `flypath: ${where} may only take plain named parameters`,
        file,
        param,
      );
    }
    const name = String(param["name"]);
    const type = readType(
      annotationOf(param),
      file,
      names,
      `${where} parameter "${name}"`,
    );
    return {
      name,
      type:
        param["optional"] === true
          ? ({ kind: "optional", value: type } as NativeType)
          : type,
    };
  });
}

function readMembers(
  members: Node[],
  file: string,
  names: Names,
  where: string,
): NativeParam[] {
  return members.map((member): NativeParam => {
    if (member["type"] !== "TSPropertySignature") {
      throw new ManifestError(
        `flypath: ${where} may only contain plain properties`,
        file,
        member,
      );
    }
    const key = member["key"] as Node;
    const name = String(key["name"] ?? key["value"] ?? "");
    if (name === "children") {
      throw new ManifestError(
        `flypath: "children" is not supported on a native component yet (${where})`,
        file,
        member,
      );
    }
    const type = readType(
      annotationOf(member),
      file,
      names,
      `${where} property "${name}"`,
    );
    return {
      name,
      type:
        member["optional"] === true
          ? ({ kind: "optional", value: type } as NativeType)
          : type,
    };
  });
}

function readComponentMembers(
  members: Node[],
  file: string,
  names: Names,
  where: string,
): { props: NativeParam[]; events: NativeEvent[] } {
  const props: NativeParam[] = [];
  const events: NativeEvent[] = [];

  for (const member of members) {
    if (member["type"] !== "TSPropertySignature") {
      throw new ManifestError(
        `flypath: ${where} may only contain plain properties`,
        file,
        member,
      );
    }
    const key = member["key"] as Node;
    const name = String(key["name"] ?? key["value"] ?? "");
    if (name === "children") {
      throw new ManifestError(
        `flypath: "children" is not supported on a native component yet (${where})`,
        file,
        member,
      );
    }

    const annotation = annotationOf(member);
    if (annotation?.["type"] === "TSFunctionType") {
      const result = (annotation["returnType"] as Node | undefined)?.[
        "typeAnnotation"
      ] as Node | undefined;
      if (result?.["type"] !== "TSVoidKeyword") {
        throw new ManifestError(
          `flypath: ${where} event "${name}" must return void`,
          file,
          member,
        );
      }
      events.push({
        name,
        params: readParams(
          (annotation["params"] as Node[]) ?? [],
          file,
          names,
          `${where} event "${name}"`,
        ),
      });
      continue;
    }

    const type = readType(
      annotation,
      file,
      names,
      `${where} property "${name}"`,
    );
    props.push({
      name,
      type:
        member["optional"] === true
          ? ({ kind: "optional", value: type } as NativeType)
          : type,
    });
  }

  return { props, events };
}

function literalUnion(node: Node | undefined): string[] | undefined {
  if (node?.["type"] !== "TSUnionType") return undefined;
  const members = (node["types"] as Node[]) ?? [];
  const values: string[] = [];
  for (const member of members) {
    if (member["type"] !== "TSLiteralType") return undefined;
    const literal = member["literal"] as Node;
    if (typeof literal["value"] !== "string") return undefined;
    values.push(literal["value"]);
  }
  return values.length === 0 ? undefined : values;
}

function declarationOf(statement: Node): Node | undefined {
  if (statement["type"] === "ExportNamedDeclaration") {
    return statement["declaration"] as Node | undefined;
  }
  return statement;
}

function webSibling(file: string): string | undefined {
  const base = file.replace(/\.[^.]+$/, "");
  for (const extension of WEB_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function cppSibling(root: string, file: string): string | undefined {
  const name = path.basename(file).replace(/\.[^.]+$/, "");
  const candidate = path.join(root, "cpp", `${name}.cpp`);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function parseModule(
  file: string,
  code: string,
  root: string,
): NativeModuleEntry {
  const { program, errors } = parseSync(file, code);
  if (errors.length > 0) {
    throw new ManifestError(
      `flypath: ${errors[0]?.message ?? "parse error"}`,
      file,
      undefined,
    );
  }

  const source = posix(path.relative(root, file));
  const slug = slugFor(source);
  const body = (program as unknown as Node)["body"] as Node[];

  const names: Names = { structs: new Set(), enums: new Set() };
  const structs: NativeStruct[] = [];
  const enums: NativeEnum[] = [];
  const functions: NativeFunction[] = [];
  const components: NativeComponentEntry[] = [];
  const pending: Array<{ node: Node; name: string }> = [];
  const propsByName = new Map<
    string,
    { props: NativeParam[]; events: NativeEvent[] }
  >();

  for (const statement of body) {
    const declaration = declarationOf(statement);
    if (!declaration) continue;
    if (declaration["type"] === "TSInterfaceDeclaration") {
      names.structs.add(String((declaration["id"] as Node)["name"]));
      continue;
    }
    if (declaration["type"] === "TSTypeAliasDeclaration") {
      const name = String((declaration["id"] as Node)["name"]);
      const values = literalUnion(declaration["typeAnnotation"] as Node);
      if (values) names.enums.add(name);
      else names.structs.add(name);
    }
  }

  for (const statement of body) {
    const type = String(statement["type"]);
    if (type === "ImportDeclaration") {
      if (statement["importKind"] !== "type") {
        throw new ManifestError(
          'flypath: a "use native" module may only use "import type"',
          file,
          statement,
        );
      }
      continue;
    }
    if (type === "ExpressionStatement") continue;

    const declaration = declarationOf(statement);
    const kind = String(declaration?.["type"] ?? "");

    if (kind === "TSInterfaceDeclaration") {
      const name = String((declaration?.["id"] as Node)["name"]);
      const members = ((declaration?.["body"] as Node)["body"] as Node[]) ?? [];
      propsByName.set(
        name,
        readComponentMembers(members, file, names, `interface "${name}"`),
      );
      const fields = propsByName.get(name)?.props ?? [];
      if ((propsByName.get(name)?.events.length ?? 0) === 0) {
        structs.push({ name, fields });
      }
      continue;
    }

    if (kind === "TSTypeAliasDeclaration") {
      const name = String((declaration?.["id"] as Node)["name"]);
      const annotation = declaration?.["typeAnnotation"] as Node;
      const values = literalUnion(annotation);
      if (values) {
        enums.push({ name, values });
        continue;
      }
      if (annotation["type"] === "TSTypeLiteral") {
        structs.push({
          name,
          fields: readMembers(
            (annotation["members"] as Node[]) ?? [],
            file,
            names,
            `type "${name}"`,
          ),
        });
        continue;
      }
      throw new ManifestError(
        `flypath: type "${name}" must be an object type or a union of string literals`,
        file,
        declaration,
      );
    }

    if (kind === "TSDeclareFunction") {
      if (statement["type"] !== "ExportNamedDeclaration") {
        throw new ManifestError(
          'flypath: every declaration in a "use native" module must be exported',
          file,
          statement,
        );
      }
      const name = String((declaration?.["id"] as Node)["name"]);
      const { result, async } = readResult(
        returnTypeOf(declaration),
        file,
        names,
        `${name}()`,
      );
      functions.push({
        name,
        params: readParams(
          (declaration?.["params"] as Node[]) ?? [],
          file,
          names,
          `${name}()`,
        ),
        result,
        async,
      });
      continue;
    }

    if (kind === "VariableDeclaration") {
      if (statement["type"] !== "ExportNamedDeclaration") {
        throw new ManifestError(
          'flypath: every declaration in a "use native" module must be exported',
          file,
          statement,
        );
      }
      for (const declarator of (declaration?.["declarations"] as Node[]) ??
        []) {
        const id = declarator["id"] as Node;
        const name = String(id["name"]);
        const annotation = annotationOf(id);
        if (
          annotation?.["type"] !== "TSTypeReference" ||
          !COMPONENT_TYPES.has(
            String((annotation["typeName"] as Node)["name"] ?? ""),
          )
        ) {
          throw new ManifestError(
            `flypath: "${name}" must be declared as NativeComponent<Props>`,
            file,
            declarator,
          );
        }
        const args = (annotation["typeArguments"] as Node | undefined)?.[
          "params"
        ] as Node[] | undefined;
        const props = args?.[0];
        pending.push({ node: props as Node, name });
      }
      continue;
    }

    throw new ManifestError(
      'flypath: a "use native" module may only contain "import type", ' +
        '"export declare" and type declarations',
      file,
      statement,
    );
  }

  for (const entry of pending) {
    const node = entry.node;
    if (node?.["type"] === "TSTypeLiteral") {
      const members = readComponentMembers(
        (node["members"] as Node[]) ?? [],
        file,
        names,
        `<${entry.name}>`,
      );
      components.push({ name: entry.name, ...members });
      continue;
    }
    if (node?.["type"] === "TSTypeReference") {
      const name = String((node["typeName"] as Node)["name"] ?? "");
      const members = propsByName.get(name);
      if (!members) {
        throw new ManifestError(
          `flypath: <${entry.name}> props type "${name}" must be an interface declared in this module`,
          file,
          node,
        );
      }
      components.push({ name: entry.name, ...members });
      continue;
    }
    throw new ManifestError(
      `flypath: <${entry.name}> needs an object props type`,
      file,
      node,
    );
  }

  return {
    id: `/${source}`,
    file,
    source,
    slug,
    functions,
    components,
    structs,
    enums,
    base: path.basename(file).replace(/\.[^.]+$/, ""),
    inline: [],
    web: webSibling(file),
    cpp: cppSibling(root, file),
  };
}

const INLINE = /["']use native["']/;

const USE_CLIENT =
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;

function hasInlineDirective(node: Node): boolean {
  const body = node["body"] as Node | undefined;
  const statements = (body?.["body"] as Node[] | undefined) ?? [];
  const first = statements[0];
  if (first?.["type"] !== "ExpressionStatement") return false;
  const expression = first["expression"] as Node;
  return expression["type"] === "Literal" && expression["value"] === DIRECTIVE;
}

function moduleBindings(body: Node[]): Set<string> {
  const names = new Set<string>();
  const add = (node: Node | undefined): void => {
    if (node?.["type"] === "Identifier") names.add(String(node["name"]));
  };
  for (const statement of body) {
    if (statement["type"] === "ImportDeclaration") {
      for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
        add(specifier["local"] as Node);
      }
      continue;
    }
    const declaration =
      statement["type"] === "ExportNamedDeclaration" ||
      statement["type"] === "ExportDefaultDeclaration"
        ? (statement["declaration"] as Node | undefined)
        : statement;
    if (!declaration) continue;
    if (declaration["type"] === "VariableDeclaration") {
      for (const declarator of (declaration["declarations"] as Node[]) ?? []) {
        add(declarator["id"] as Node);
      }
      continue;
    }
    if (
      declaration["type"] === "FunctionDeclaration" ||
      declaration["type"] === "ClassDeclaration"
    ) {
      add(declaration["id"] as Node);
    }
  }
  return names;
}

function assertNoCaptures(
  node: Node,
  bindings: Set<string>,
  file: string,
  name: string,
): void {
  const locals = new Set<string>(
    ((node["params"] as Node[]) ?? []).flatMap((param) =>
      param["type"] === "Identifier" ? [String(param["name"])] : [],
    ),
  );
  locals.add(name);

  walk(node["body"], (child) => {
    if (child["type"] === "VariableDeclarator") {
      const id = child["id"] as Node;
      if (id["type"] === "Identifier") locals.add(String(id["name"]));
    }
    if (child["type"] === "FunctionDeclaration") {
      const id = child["id"] as Node | undefined;
      if (id) locals.add(String(id["name"]));
    }
  });

  walk(node["body"], (child) => {
    if (child["type"] !== "Identifier") return;
    const value = String(child["name"]);
    if (locals.has(value) || !bindings.has(value)) return;
    throw new ManifestError(
      `flypath: inline "use native" function ${name}() captures "${value}" — ` +
        "nothing can cross into Swift or Kotlin",
      file,
      child,
    );
  });
}

export function parseInlineModule(
  file: string,
  code: string,
  root: string,
): NativeModuleEntry | undefined {
  const { program, errors } = parseSync(file, code);
  if (errors.length > 0) return undefined;

  const body = (program as unknown as Node)["body"] as Node[];
  const candidates: Node[] = [];
  for (const statement of body) {
    const declaration =
      statement["type"] === "ExportNamedDeclaration" ||
      statement["type"] === "ExportDefaultDeclaration"
        ? (statement["declaration"] as Node | undefined)
        : statement;
    if (declaration?.["type"] !== "FunctionDeclaration") continue;
    if (!hasInlineDirective(declaration)) continue;
    candidates.push(declaration);
  }
  if (candidates.length === 0) return undefined;

  if (!USE_CLIENT.test(code)) {
    throw new ManifestError(
      'flypath: an inline "use native" function may only live in a "use client" module',
      file,
      candidates[0],
    );
  }

  const source = posix(path.relative(root, file));
  const bindings = moduleBindings(body);
  const names: Names = { structs: new Set(), enums: new Set() };
  const functions: NativeFunction[] = [];
  const inline: NativeInline[] = [];

  for (const node of candidates) {
    const name = String((node["id"] as Node)["name"]);
    assertNoCaptures(node, bindings, file, name);
    const { result, async } = readResult(
      returnTypeOf(node),
      file,
      names,
      `${name}()`,
    );
    functions.push({
      name,
      params: readParams(
        (node["params"] as Node[]) ?? [],
        file,
        names,
        `${name}()`,
      ),
      result,
      async,
    });
    inline.push({
      name,
      start: node["start"] as number,
      end: node["end"] as number,
    });
  }

  return {
    id: `/${source}`,
    file,
    source,
    slug: slugFor(source),
    functions,
    components: [],
    structs: [],
    enums: [],
    base: path.basename(file).replace(/\.[^.]+$/, ""),
    inline,
    web: undefined,
    cpp: undefined,
  };
}

function webExports(file: string): Set<string> {
  const names = new Set<string>();
  let code: string;
  try {
    code = fs.readFileSync(file, "utf8");
  } catch {
    return names;
  }
  const { program, errors } = parseSync(file, code);
  if (errors.length > 0) return names;

  for (const statement of (program as unknown as Node)["body"] as Node[]) {
    if (statement["type"] !== "ExportNamedDeclaration") continue;
    const declaration = statement["declaration"] as Node | undefined;
    if (declaration?.["type"] === "FunctionDeclaration") {
      names.add(String((declaration["id"] as Node)["name"]));
      continue;
    }
    if (declaration?.["type"] === "VariableDeclaration") {
      for (const declarator of (declaration["declarations"] as Node[]) ?? []) {
        const id = declarator["id"] as Node;
        if (id["type"] === "Identifier") names.add(String(id["name"]));
      }
      continue;
    }
    for (const specifier of (statement["specifiers"] as Node[]) ?? []) {
      const exported = specifier["exported"] as Node | undefined;
      if (exported) names.add(String(exported["name"] ?? exported["value"]));
    }
  }
  return names;
}

function checkWebParity(module: NativeModuleEntry): void {
  if (module.web === undefined) return;
  const actual = webExports(module.web);
  const missing = exportNames(module).filter((name) => !actual.has(name));
  if (missing.length === 0) return;
  throw new ManifestError(
    `flypath: ${posix(path.basename(module.web))} does not export ${missing.join(
      ", ",
    )} — a web implementation must match ${module.source}`,
    module.web,
    undefined,
  );
}

export function buildManifest(root: string): NativeManifest {
  const files: string[] = [];
  scan(root, files);

  const modules: NativeModuleEntry[] = [];
  for (const file of files.sort()) {
    let code: string;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (hasDirective(code)) {
      modules.push(parseModule(file, code, root));
      continue;
    }
    if (!INLINE.test(code)) continue;
    const inline = parseInlineModule(file, code, root);
    if (inline) modules.push(inline);
  }

  for (const module of modules) checkWebParity(module);

  const owners = new Map<string, string>();
  for (const module of modules) {
    for (const name of [
      ...module.functions.map((entry) => entry.name),
      ...module.components.map((entry) => entry.name),
    ]) {
      const existing = owners.get(name);
      if (existing) {
        throw new ManifestError(
          `flypath: "${name}" is exported by both ${existing} and ${module.source} — ` +
            '"use native" exports bind by symbol name and must be unique',
          module.file,
          undefined,
        );
      }
      owners.set(name, module.source);
    }
  }

  return {
    hash: hash(
      JSON.stringify(
        modules.map((module) => ({
          id: module.id,
          functions: module.functions,
          components: module.components,
          structs: module.structs,
          enums: module.enums,
          inline: module.inline.map((entry) => entry.name),
        })),
      ),
    ),
    modules,
  };
}

export function exportNames(module: NativeModuleEntry): string[] {
  return [
    ...module.functions.map((entry) => entry.name),
    ...module.components.map((entry) => entry.name),
  ];
}
