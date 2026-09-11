import { Suspense } from "react";

import { notFound, route, routes } from "../../../src/router/config.ts";
import { context } from "../../../src/router/context.ts";
import { navigate } from "../../../src/router/navigate-server.ts";
import { cookies } from "../../../src/runtime/cookies.ts";
import { headers } from "../../../src/runtime/platform.ts";
import { missingAction, redirectAction } from "./streaming-actions.ts";

let gate = Promise.withResolvers<void>();
const value = context<string>();

export function reset() {
  gate = Promise.withResolvers<void>();
}

export function release() {
  gate.resolve();
}

export function actionId(kind: "redirect" | "missing"): string {
  return (
    (kind === "redirect" ? redirectAction : missingAction) as unknown as {
      $$id: string;
    }
  ).$$id;
}

async function Delayed() {
  await gate.promise;
  return (
    <span>
      finished:{value()}:{headers().get("x-reader")}
    </span>
  );
}

function Page() {
  return (
    <Suspense fallback={<span>waiting-for-data</span>}>
      <Delayed />
    </Suspense>
  );
}

function Missing() {
  return <span>missing-page</span>;
}

export const tree = routes([
  route("slow", async () => ({ default: Page }), {
    middleware: [
      async (next) => {
        value.set("before");
        await next();
        value.set("after");
        headers.set("x-after", "yes");
      },
    ],
  }),
  route("redirect", async () => ({ default: Page }), {
    middleware: [
      () => {
        cookies.set("session", "new");
        navigate("/destination");
      },
    ],
  }),
  route("destination", async () => ({
    default: () => <span>destination:{cookies("session")}</span>,
  })),
  route("missing", async () => ({ default: Page }), {
    middleware: [() => navigate("not-found")],
  }),
  notFound(async () => ({ default: Missing })),
]);
