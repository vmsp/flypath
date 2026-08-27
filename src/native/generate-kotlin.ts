import type {
  NativeComponentEntry,
  NativeEvent,
  NativeFunction,
  NativeManifest,
  NativeParam,
  NativeType,
} from "./manifest.ts";
import { componentName, eventType } from "./manifest.ts";

function kotlinType(type: NativeType): string {
  switch (type.kind) {
    case "void":
      return "Unit";
    case "boolean":
      return "Boolean";
    case "number":
      return "Double";
    case "string":
      return "String";
    case "bytes":
      return "ByteArray";
    case "array":
      return `List<${kotlinType(type.element)}>`;
    case "optional":
      return `${kotlinType(type.value)}?`;
    case "struct":
    case "enum":
      return type.name;
  }
}

function decode(type: NativeType, value: string): string {
  switch (type.kind) {
    case "void":
      return "Unit";
    case "boolean":
      return `${value}.bool`;
    case "number":
      return `${value}.number`;
    case "string":
      return `${value}.string`;
    case "bytes":
      return `${value}.bytes`;
    case "array":
      return `${value}.list { ${decode(type.element, "it")} }`;
    case "optional":
      return `${value}.orNull { ${decode(type.value, "it")} }`;
    case "struct":
      return `${type.name}.flypathDecode(${value})`;
    case "enum":
      return `${type.name}.flypathDecode(${value})`;
  }
}

function encode(type: NativeType, value: string, out: string): string {
  switch (type.kind) {
    case "void":
      return `${out}.setNull()`;
    case "boolean":
    case "number":
    case "string":
    case "bytes":
      return `${out}.set(${value})`;
    case "array":
      return `${out}.setList(${value}) { item, slot -> ${encode(
        type.element,
        "item",
        "slot",
      )} }`;
    case "optional":
      return `${out}.setOrNull(${value}) { item, slot -> ${encode(
        type.value,
        "item",
        "slot",
      )} }`;
    case "struct":
    case "enum":
      return `${value}.flypathEncode(${out})`;
  }
}

function propRead(type: NativeType, name: string): string {
  const key = JSON.stringify(name);
  switch (type.kind) {
    case "boolean":
      return `props.bool(${key})`;
    case "number":
      return `props.number(${key})`;
    case "string":
      return `props.string(${key})`;
    case "bytes":
      return `props.bytes(${key})`;
    case "array":
      return `props.list(${key})`;
    case "optional":
      return `if (props.isNull(${key})) null else ${propRead(type.value, name)}`;
    case "struct":
      return `${type.name}.flypathFromProps(props.props(${key}))`;
    case "enum":
      return `${type.name}.entries.first { it.flypathValue == props.string(${key}) }`;
    case "void":
      return "Unit";
  }
}

function caseName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

function structDeclaration(name: string, fields: NativeParam[]): string {
  const properties = fields.map(
    (field) => `    public val ${field.name}: ${kotlinType(field.type)},`,
  );
  const decoded = fields.map(
    (field) =>
      `            ${field.name} = ${decode(
        field.type,
        `value.field(${JSON.stringify(field.name)})`,
      )},`,
  );
  const encoded = fields.map(
    (field) =>
      `        ${encode(
        field.type,
        field.name,
        `target.field(${JSON.stringify(field.name)})`,
      )}`,
  );

  return [
    `public data class ${name}(`,
    ...properties,
    ") {",
    "    public fun flypathEncode(out: FlypathOut) {",
    "        val target = out.obj()",
    ...encoded,
    "    }",
    "",
    "    public companion object {",
    `        public fun flypathDecode(value: FlypathValue): ${name} =`,
    `            ${name}(`,
    ...decoded,
    "            )",
    "",
    `        public fun flypathFromProps(props: FlypathProps): ${name} =`,
    `            ${name}(`,
    ...fields.map(
      (field) =>
        `            ${field.name} = ${propRead(field.type, field.name)},`,
    ),
    "            )",
    "    }",
    "}",
  ].join("\n");
}

function enumDeclaration(name: string, values: string[]): string {
  const cases = values.map(
    (value) => `    ${caseName(value)}(${JSON.stringify(value)}),`,
  );
  return [
    `public enum class ${name}(public val flypathValue: String) {`,
    ...cases,
    "    ;",
    "",
    "    public fun flypathEncode(out: FlypathOut) {",
    "        out.set(flypathValue)",
    "    }",
    "",
    "    public companion object {",
    `        public fun flypathDecode(value: FlypathValue): ${name} =`,
    "            entries.first { it.flypathValue == value.string }",
    "    }",
    "}",
  ].join("\n");
}

function call(entry: NativeFunction): string {
  const args = entry.params
    .map((param) => `${param.name} = ${param.name}`)
    .join(", ");
  return `${entry.name}(${args})`;
}

function reads(entry: NativeFunction, indent: string): string[] {
  if (entry.params.length === 0) return [];
  return [
    `${indent}val arguments = FlypathValue(args)`,
    ...entry.params.map(
      (param, index) =>
        `${indent}val ${param.name} = ${decode(
          param.type,
          `arguments.at(${index})`,
        )}`,
    ),
  ];
}

function adapter(slug: string, entry: NativeFunction): string {
  const name = `${slug}_${entry.name}`;
  if (entry.async) {
    const settle =
      entry.result.kind === "void"
        ? [`            ${call(entry)}`]
        : [`            ${encode(entry.result, call(entry), "handle.out()")}`];
    return [
      "    @JvmStatic",
      `    public fun ${name}(args: Long, promise: Long) {`,
      ...reads(entry, "        "),
      "        val handle = FlypathPromise(promise)",
      "        FlypathTasks.run(handle) {",
      ...settle,
      "            handle.resolve()",
      "        }",
      "    }",
    ].join("\n");
  }

  const body =
    entry.result.kind === "void"
      ? [`        ${call(entry)}`]
      : [`        ${encode(entry.result, call(entry), "FlypathOut(result)")}`];

  return [
    "    @JvmStatic",
    `    public fun ${name}(args: Long, result: Long) {`,
    ...reads(entry, "        "),
    ...body,
    "    }",
  ].join("\n");
}

function eventArgument(event: NativeEvent): string {
  const params = event.params.map((param) => param.name);
  const head = params.length === 0 ? "" : `${params.join(", ")} -> `;
  const payload = params
    .map((name) => `${JSON.stringify(name)} to ${name}`)
    .join(", ");
  return `${event.name} = { ${head}events.emit(${JSON.stringify(
    eventType(event.name),
  )}, mapOf(${payload})) }`;
}

function registration(slug: string, entry: NativeComponentEntry): string {
  const args = [
    ...entry.props.map(
      (prop) => `${prop.name} = ${propRead(prop.type, prop.name)}`,
    ),
    ...entry.events.map((event) => eventArgument(event)),
  ].join(", ");
  return [
    `        FlypathViewRegistry.register(${JSON.stringify(
      componentName(slug, entry.name),
    )}) { props, events ->`,
    `            ${entry.name}(${args})`,
    "        }",
  ].join("\n");
}

export function generateKotlin(manifest: NativeManifest): string {
  const types = manifest.modules
    .filter((module) => module.cpp === undefined)
    .flatMap((module) => [
      ...module.structs.map((entry) =>
        structDeclaration(entry.name, entry.fields),
      ),
      ...module.enums.map((entry) => enumDeclaration(entry.name, entry.values)),
    ]);

  const adapters = manifest.modules
    .filter((module) => module.cpp === undefined)
    .flatMap((module) =>
      module.functions.map((entry) => adapter(module.slug, entry)),
    );

  const registrations = manifest.modules.flatMap((module) =>
    module.components.map((entry) => registration(module.slug, entry)),
  );

  const sources = manifest.modules
    .filter((module) => module.cpp === undefined)
    .map((module) => module.source)
    .join(", ");

  return [
    `// Generated by flypath from ${sources}. Do not edit.`,
    "import dev.flypath.kit.FlypathOut",
    "import dev.flypath.kit.FlypathEvents",
    "import dev.flypath.kit.FlypathProps",
    "import dev.flypath.kit.FlypathPromise",
    "import dev.flypath.kit.FlypathTasks",
    "import dev.flypath.kit.FlypathValue",
    "import dev.flypath.kit.FlypathViewRegistry",
    "",
    ...types.map((value) => `${value}\n`),
    "public object FlypathGenerated {",
    "    @JvmStatic",
    "    public fun registerViews() {",
    registrations.join("\n"),
    "    }",
    ...(adapters.length === 0 ? [] : ["", adapters.join("\n\n")]),
    "}",
    "",
  ].join("\n");
}
