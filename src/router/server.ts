import { forbidPrerender, getRequest, VISITOR } from "../runtime/platform.ts";
import { makeParams, makeQuery } from "./read.ts";
import type { ParamsReader, QueryReader, RouteInfo } from "./types.ts";

function info(): RouteInfo {
  const value = getRequest();
  if (!value) {
    throw new Error(
      "params() and query() are only available while the flypath " +
        "router is handling a request",
    );
  }
  return value;
}

function search(): RouteInfo {
  forbidPrerender("query() was read", VISITOR);
  return info();
}

export const params: ParamsReader = makeParams(info);

export const query: QueryReader = makeQuery(search);
