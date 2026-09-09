/**
 * @fileoverview The `enqueue` and `cron` call-site rewrite, on the rsc
 * environment.
 *
 * `() => resize(a, b)` becomes `() => [resize, [a, b]]`. Call-sites stay simple
 * and can leverage the usual type-checking infrastructure. Captured variables
 * and spread evaluate at enqueue-time.
 */

import type { SourceMap } from "magic-string";
import MagicString from "magic-string";
import { parseSync } from "oxc-parser";
import type { Plugin } from "vite";

import type { Node } from "./eval.ts";
import { unwrap, walk } from "./eval.ts";

export type ModuleRecord = {
  staticImports: {
    moduleRequest: { value: string };
    entries: {
      importName: { kind: string; name: string | null };
      localName: { value: string };
      isType: boolean;
    }[];
  }[];
  staticExports: {
    entries: {
      moduleRequest: { value: string } | null;
      exportName: { kind: string; name: string | null };
      localName: { kind: string; name: string | null };
      isType: boolean;
    }[];
  }[];
};

export type Parsed = { program: Node; module: ModuleRecord };

export type Site = { thunk: Node; kind: "enqueue" | "cron" };

export class JobError extends Error {
  constructor(
    message: string,
    readonly start: number,
  ) {
    super(message);
  }
}

function locate(code: string, index: number): string {
  const before = code.slice(0, index);
  const line = before.split("\n").length;
  const column = index - (before.lastIndexOf("\n") + 1) + 1;
  return `${String(line)}:${String(column)}`;
}

export function located(id: string, code: string, error: JobError): Error {
  return new Error(`${error.message}\n  at ${id}:${locate(code, error.start)}`);
}

export function parse(id: string, code: string): Parsed | undefined {
  const result = parseSync(id, code);
  if (result.errors.length > 0) return undefined;
  return {
    program: result.program as unknown as Node,
    module: result.module as unknown as ModuleRecord,
  };
}

export function mayHaveSites(code: string): boolean {
  return code.includes(".enqueue(") || code.includes("cron(");
}

function flypathBindings(record: ModuleRecord, name: string): Set<string> {
  const out = new Set<string>();
  for (const entry of record.staticImports) {
    if (entry.moduleRequest.value !== "flypath") continue;
    for (const specifier of entry.entries) {
      if (specifier.isType) continue;
      if (specifier.importName.name !== name) continue;
      out.add(specifier.localName.value);
    }
  }
  return out;
}

function identifierName(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  return node["type"] === "Identifier" ? String(node["name"]) : undefined;
}

export function sites(parsed: Parsed): Site[] {
  const jobsNames = flypathBindings(parsed.module, "jobs");
  const cronNames = flypathBindings(parsed.module, "cron");
  if (jobsNames.size === 0 && cronNames.size === 0) return [];

  const handles = new Set<string>();
  walk(parsed.program, (node) => {
    if (node["type"] !== "VariableDeclarator") return;
    const init = node["init"] as Node | undefined;
    const id = node["id"] as Node | undefined;
    if (!init || !id || id["type"] !== "Identifier") return;
    const call = unwrap(init);
    if (call["type"] !== "CallExpression") return;
    const callee = identifierName(unwrap(call["callee"] as Node));
    if (callee !== undefined && jobsNames.has(callee)) {
      handles.add(String(id["name"]));
    }
  });

  const found: Site[] = [];
  walk(parsed.program, (node) => {
    if (node["type"] !== "CallExpression") return;
    const callee = unwrap(node["callee"] as Node);
    const args = (node["arguments"] as Node[]) ?? [];

    if (
      callee["type"] === "Identifier" &&
      cronNames.has(String(callee["name"]))
    ) {
      const thunk = args[1];
      if (thunk) found.push({ thunk: unwrap(thunk), kind: "cron" });
      return;
    }

    if (callee["type"] !== "MemberExpression") return;
    if (callee["computed"] === true) return;
    if (identifierName(callee["property"] as Node) !== "enqueue") return;

    const object = unwrap(callee["object"] as Node);
    const direct =
      object["type"] === "CallExpression" &&
      jobsNames.has(identifierName(unwrap(object["callee"] as Node)) ?? "");
    const viaHandle =
      object["type"] === "Identifier" && handles.has(String(object["name"]));
    if (!direct && !viaHandle) return;

    for (const argument of args) {
      found.push({ thunk: unwrap(argument), kind: "enqueue" });
    }
  });

  return found;
}

function startOf(node: Node): number {
  return node["start"] as number;
}

const NESTED = new Set([
  "CallExpression",
  "NewExpression",
  "AwaitExpression",
  "TaggedTemplateExpression",
]);

function rejectNested(argument: Node): void {
  let offender: Node | undefined;
  walk(argument, (node) => {
    if (offender) return;
    if (NESTED.has(String(node["type"]))) offender = node;
  });
  if (!offender) return;
  throw new JobError(
    "flypath: an enqueued call may not take another call as an argument; " +
      "compute it before the arrow and pass the value",
    startOf(offender),
  );
}

export type Analysis =
  | { kind: "reference"; callee: Node }
  | { kind: "call"; callee: Node; args: Node[]; body: Node };

export function analyze(thunk: Node): Analysis {
  if (thunk["type"] === "Identifier" || thunk["type"] === "MemberExpression") {
    return { kind: "reference", callee: thunk };
  }

  if (thunk["type"] !== "ArrowFunctionExpression") {
    throw new JobError(
      "flypath: a job must be enqueued as an arrow literal whose body is one " +
        "call, or as a bare function reference",
      startOf(thunk),
    );
  }

  const body = thunk["body"] as Node;
  if (body["type"] === "BlockStatement") {
    throw new JobError(
      "flypath: an enqueued arrow must have an expression body that is " +
        "exactly one call",
      startOf(body),
    );
  }

  let call = unwrap(body);
  if (call["type"] === "AwaitExpression") {
    call = unwrap(call["argument"] as Node);
  }
  if (call["type"] !== "CallExpression") {
    throw new JobError(
      "flypath: an enqueued arrow's body must be exactly one call",
      startOf(call),
    );
  }

  const args = (call["arguments"] as Node[]) ?? [];
  for (const argument of args) rejectNested(argument);
  return { kind: "call", callee: call["callee"] as Node, args, body };
}

type Rewrite = { start: number; end: number; text: string };

function rewriteOf(code: string, thunk: Node): Rewrite | undefined {
  const analysis = analyze(thunk);
  if (analysis.kind === "reference") return undefined;

  const { callee, args, body } = analysis;
  const calleeText = code.slice(startOf(callee), callee["end"] as number);
  const argTexts = args.map((argument) =>
    code.slice(startOf(argument), argument["end"] as number),
  );

  return {
    start: startOf(body),
    end: body["end"] as number,
    text: `[${calleeText}, [${argTexts.join(", ")}]]`,
  };
}

export function rewriteJobs(
  id: string,
  code: string,
): { code: string; map: SourceMap } | undefined {
  if (!mayHaveSites(code)) return undefined;
  const parsed = parse(id, code);
  if (!parsed) return undefined;

  const found = sites(parsed);
  if (found.length === 0) return undefined;

  const output = new MagicString(code);
  let changed = false;
  for (const site of found) {
    let rewrite;
    try {
      rewrite = rewriteOf(code, site.thunk);
    } catch (error) {
      if (error instanceof JobError) throw located(id, code, error);
      throw error;
    }
    if (!rewrite) continue;
    output.update(rewrite.start, rewrite.end, rewrite.text);
    changed = true;
  }

  if (!changed) return undefined;
  return {
    code: output.toString(),
    map: output.generateMap({ hires: true, source: id }),
  };
}

export function jobsTransform(): Plugin {
  return {
    name: "flypath:jobs",
    enforce: "pre",
    transform(code, id) {
      if (this.environment.name !== "rsc") return undefined;
      if (id.includes("/node_modules/")) return undefined;
      return rewriteJobs(id, code);
    },
  };
}
