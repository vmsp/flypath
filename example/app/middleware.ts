import type { Middleware } from "flypath";
import { isPrefetch, navigate } from "flypath";

import { requestId, session, userFromSession, visitor } from "./session.ts";

let served = 0;

export const request: Middleware = async (next) => {
  served += 1;
  const id = `req-${String(served)}`;
  requestId.set(id);
  visitor.set(userFromSession() ?? null);

  const started = Date.now();
  const response = await next();
  response.headers.set("x-request-id", id);
  response.headers.set("x-request-ms", String(Date.now() - started));
  if (isPrefetch()) response.headers.set("x-request-prefetch", "1");
};

export const auth: Middleware = () => {
  const user = userFromSession();
  if (!user) return navigate("/login");
  session.set(user);
};
