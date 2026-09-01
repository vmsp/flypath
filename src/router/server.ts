import { getRequest } from "../runtime/platform.ts";
import { makeParams, makeQuery } from "./read.ts";
import type { ParamsReader, QueryReader, RouteInfo } from "./types.ts";

function info(): RouteInfo {
  const value = getRequest();
  if (!value) {
    throw new Error(
      "flypath: params() and query() are only available while the flypath " +
        "router is handling a request",
    );
  }
  return value;
}

export const params: ParamsReader = makeParams(info);

export const query: QueryReader = makeQuery(info);
