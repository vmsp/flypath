import { getRequest } from "../runtime/platform.ts";
import type {
  Navigation,
  Pattern,
  RouteParams,
  SearchParams,
} from "./types.ts";

export { notFound, redirect } from "./navigation.ts";

function navigation(): Navigation {
  const info = getRequest();
  if (!info) {
    throw new Error(
      "flypath: navigation hooks are only available while the flypath " +
        "router is rendering a request",
    );
  }
  return info;
}

export function useParams<P extends Pattern = never>(): RouteParams<P> {
  return navigation().params as RouteParams<P>;
}

export function useSearchParams(): SearchParams {
  return navigation().searchParams;
}
