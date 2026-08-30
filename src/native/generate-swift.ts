import type {
  NativeComponentEntry,
  NativeEvent,
  NativeFunction,
  NativeModuleEntry,
  NativeParam,
  NativeType,
} from "./manifest.ts";
import { eventType, symbolFor, viewSymbolFor } from "./manifest.ts";

function swiftType(type: NativeType): string {
  switch (type.kind) {
    case "void":
      return "Void";
    case "boolean":
      return "Bool";
    case "number":
      return "Double";
    case "string":
      return "String";
    case "bytes":
      return "[UInt8]";
    case "array":
      return `[${swiftType(type.element)}]`;
    case "optional":
      return `${swiftType(type.value)}?`;
    case "struct":
    case "enum":
      return type.name;
  }
}

function decode(type: NativeType, value: string): string {
  if (type.kind === "bytes") return `${value}.bytes`;
  return `${swiftType(type)}(flypath: ${value})`;
}

function encode(type: NativeType, value: string, out: string): string[] {
  if (type.kind === "void") return [];
  if (type.kind === "bytes") return [`${out}.set(${value})`];
  return [`${value}.flypathEncode(${out})`];
}

function caseName(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const head = parts[0] ?? "value";
  const rest = parts
    .slice(1)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`);
  const name = `${head[0]?.toLowerCase() ?? ""}${head.slice(1)}${rest.join("")}`;
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

function structDeclaration(name: string, fields: NativeParam[]): string {
  const properties = fields.map(
    (field) => `  public var ${field.name}: ${swiftType(field.type)}`,
  );
  const initParams = fields
    .map((field) => `${field.name}: ${swiftType(field.type)}`)
    .join(", ");
  const assignments = fields.map(
    (field) => `    self.${field.name} = ${field.name}`,
  );
  const decoded = fields.map(
    (field) =>
      `    self.${field.name} = ${decode(field.type, `value.field(${JSON.stringify(field.name)})`)}`,
  );
  const encoded = fields.flatMap((field) =>
    encode(
      field.type,
      `${field.name}`,
      `object.field(${JSON.stringify(field.name)})`,
    ).map((line) => `    ${line}`),
  );

  return [
    `public struct ${name}: FlypathDecodable, FlypathEncodable, Sendable {`,
    ...properties,
    "",
    `  public init(${initParams}) {`,
    ...assignments,
    "  }",
    "",
    "  public init(flypath value: FlypathValue) {",
    ...decoded,
    "  }",
    "",
    "  public func flypathEncode(_ out: FlypathOut) {",
    "    let object = out.object()",
    ...encoded,
    "  }",
    "}",
  ].join("\n");
}

function enumDeclaration(name: string, values: string[]): string {
  const cases = values.map(
    (value) => `  case ${caseName(value)} = ${JSON.stringify(value)}`,
  );
  return [
    `public enum ${name}: String, FlypathDecodable, FlypathEncodable, Sendable {`,
    ...cases,
    "",
    "  public init(flypath value: FlypathValue) {",
    `    self = ${name}(rawValue: value.string) ?? .${caseName(values[0] ?? "value")}`,
    "  }",
    "",
    "  public func flypathEncode(_ out: FlypathOut) {",
    "    out.set(rawValue)",
    "  }",
    "}",
  ].join("\n");
}

function call(entry: NativeFunction): string {
  const args = entry.params
    .map((param) => `${param.name}: ${param.name}`)
    .join(", ");
  return `${entry.name}(${args})`;
}

function reads(entry: NativeFunction): string[] {
  if (entry.params.length === 0) return [];
  return [
    "  let arguments = FlypathValue(args)",
    ...entry.params.map(
      (param, index) =>
        `  let ${param.name} = ${decode(param.type, `arguments.at(${index})`)}`,
    ),
  ];
}

function syncFunction(slug: string, entry: NativeFunction): string {
  const body = [
    ...reads(entry),
    ...(entry.result.kind === "void"
      ? [`  ${call(entry)}`]
      : [
          `  let value = ${call(entry)}`,
          ...encode(entry.result, "value", "FlypathOut(result)").map(
            (line) => `  ${line}`,
          ),
        ]),
  ];
  return [
    `@_cdecl(${JSON.stringify(symbolFor(slug, entry.name))})`,
    `func ${symbolFor(slug, entry.name)}(_ args: FlypathValueRef, _ result: FlypathOutRef) {`,
    ...body,
    "}",
  ].join("\n");
}

function asyncFunction(slug: string, entry: NativeFunction): string {
  const settle =
    entry.result.kind === "void"
      ? [
          `      _ = try await flypathAwait(await ${call(entry)})`,
          "      handle.resolve()",
        ]
      : [
          `      let value = try await flypathAwait(await ${call(entry)})`,
          "      handle.resolve(value)",
        ];

  return [
    `@_cdecl(${JSON.stringify(symbolFor(slug, entry.name))})`,
    `func ${symbolFor(slug, entry.name)}(_ args: FlypathValueRef, _ promise: FlypathPromiseRef) {`,
    ...reads(entry),
    "  let handle = FlypathPromise(promise)",
    "  Task {",
    "    do {",
    ...settle,
    "    } catch {",
    "      handle.reject(error)",
    "    }",
    "  }",
    "}",
  ].join("\n");
}

function eventArgument(event: NativeEvent): string {
  const params = event.params.map((param) => param.name);
  const signature = params.length === 0 ? "" : `${params.join(", ")} in`;
  const writes = event.params.map(
    (param) =>
      `        ${encode(param.type, param.name, `payload.field(${JSON.stringify(param.name)})`).join("")}`,
  );
  return [
    `${event.name}: { ${signature}`,
    `        events.emit(${JSON.stringify(eventType(event.name))}) { payload in`,
    ...writes.map((line) => `  ${line}`),
    "        }",
    "      }",
  ].join("\n");
}

function view(slug: string, entry: NativeComponentEntry): string {
  const args = [
    ...entry.props.map(
      (prop) =>
        `${prop.name}: ${decode(prop.type, `props.field(${JSON.stringify(prop.name)})`)}`,
    ),
    ...entry.events.map((event) => eventArgument(event)),
  ].join(", ");

  return [
    "@MainActor",
    `@_cdecl(${JSON.stringify(viewSymbolFor(slug, entry.name))})`,
    `func ${viewSymbolFor(slug, entry.name)}(`,
    "  _ raw: FlypathValueRef,",
    "  _ view: FlypathViewRef",
    ") -> FlypathHostRef {",
    "  let events = FlypathEvents(view)",
    "  return FlypathHostRef(",
    "    OpaquePointer(",
    "      Unmanaged.passRetained(",
    "        FlypathHost(props: FlypathValue(raw)) { props in",
    `          AnyView(${entry.name}(${args}))`,
    "        }",
    "      ).toOpaque()",
    "    )",
    "  )",
    "}",
  ].join("\n");
}

export function generateSwift(module: NativeModuleEntry): string {
  const parts = [
    `// Generated by flypath from ${module.source}. Do not edit.`,
    "import Flypath",
    "import SwiftUI",
    "",
    ...module.structs.map((entry) =>
      structDeclaration(entry.name, entry.fields),
    ),
    ...module.enums.map((entry) => enumDeclaration(entry.name, entry.values)),
    ...module.functions.map((entry) =>
      entry.async
        ? asyncFunction(module.slug, entry)
        : syncFunction(module.slug, entry),
    ),
    ...module.components.map((entry) => view(module.slug, entry)),
  ];
  return `${parts.join("\n\n")}\n`;
}
