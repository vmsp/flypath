import fs from "node:fs";
import readline from "node:readline/promises";

import type { SchemaState } from "../schema/types.ts";
import { emptyState } from "../schema/types.ts";
import type { Prompt } from "./diff.ts";
import { conservative, diff } from "./diff.ts";
import {
  discover,
  importModule,
  loadAll,
  schemaFile,
  writeMigration,
} from "./files.ts";
import type { Operation } from "./operations.ts";
import { apply } from "./state.ts";
import { schemaState } from "./state.ts";
import { migrationName, migrationSource, timestamp } from "./writer.ts";

export function terminalPrompt(): Prompt {
  if (!process.stdin.isTTY) return conservative;
  const ask = async (question: string): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(`${question} `);
    } finally {
      rl.close();
    }
  };
  return {
    confirm: async (question) =>
      (await ask(`${question} [y/N]`)).trim().toLowerCase().startsWith("y"),
    value: async (question) => (await ask(question)).trim() || undefined,
  };
}

async function historyState(root: string): Promise<SchemaState> {
  let state = emptyState();
  for (const entry of await loadAll(discover(root))) {
    for (const operation of entry.migration.operations) {
      state = apply(state, operation);
    }
  }
  return state;
}

async function targetState(root: string): Promise<SchemaState> {
  const file = schemaFile(root);
  if (!fs.existsSync(file)) {
    throw new Error(`flypath: no schema found — create ${file}`);
  }
  return schemaState(await importModule(file));
}

export async function makemigration(
  root: string,
  options: {
    name?: string;
    empty?: boolean;
    check?: boolean;
    prompt?: Prompt;
    now?: Date;
  } = {},
): Promise<{ file?: string; operations: Operation[] }> {
  const history = await historyState(root);
  const operations = options.empty
    ? []
    : await diff(
        history,
        await targetState(root),
        options.prompt ?? conservative,
      );
  const fresh = Object.keys(history.tables).length === 0;

  if (options.check) return { operations };
  if (operations.length === 0 && !options.empty) return { operations };

  const generated =
    fresh && !options.empty ? "initial" : migrationName(operations);
  const id = `${timestamp(options.now)}_${options.name ?? generated}`;
  const file = writeMigration(root, id, migrationSource(operations));
  return { file, operations };
}
