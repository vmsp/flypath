import { AsyncLocalStorage } from "node:async_hooks";

import { globals, singleton } from "../shared/globals.ts";

export type MailContext = {
  subject: string | undefined;
  baseUrl: string | undefined;
  cids: Set<string>;
};

function storage(): AsyncLocalStorage<MailContext> {
  return singleton("mailStorage", () => new AsyncLocalStorage<MailContext>());
}

export function runInMail<T>(context: MailContext, fn: () => T): T {
  return storage().run(context, fn);
}

export function mailContext(): MailContext | undefined {
  return globals().mailStorage?.getStore();
}

export function isEmail(): boolean {
  return globals().mailStorage?.getStore() !== undefined;
}

export function requireMail(what: string): MailContext {
  const context = mailContext();
  if (!context) {
    throw new Error(
      `${what} only renders inside an email; pass the component to ` +
        "sendMail({ content }) rather than rendering it as a page",
    );
  }
  return context;
}
