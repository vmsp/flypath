import type { Middleware } from "flypath";
import { headers, isPrefetch, navigate } from "flypath";

import { requestId, session, userFromSession, visitor } from "./session.ts";

let served = 0;

export const request: Middleware = async (next) => {
  served += 1;
  const id = `req-${String(served)}`;
  requestId.set(id);
  visitor.set(userFromSession() ?? null);

  headers.set("x-request-id", id);
  if (isPrefetch()) headers.set("x-request-prefetch", "1");

  const started = Date.now();
  await next();
  headers.set("x-request-ms", String(Date.now() - started));
};

export const auth: Middleware = () => {
  const user = userFromSession();
  if (!user) return navigate("/login");
  session.set(user);
};
