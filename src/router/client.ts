import type { Context } from "react";
import { createContext, useContext } from "react";

import type {
  notFound as serverNotFound,
  redirect as serverRedirect,
} from "./navigation.ts";
import type {
  Navigation,
  Pattern,
  RouteParams,
  SearchParams,
} from "./types.ts";

export const NavigationContext: Context<Navigation | null> =
  createContext<Navigation | null>(null);

let handler: (() => void) | undefined;

export function registerBack(fn: (() => void) | undefined): void {
  handler = fn;
}

export function back(): void {
  handler?.();
}

function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error(
      "flypath: navigation hooks are only available inside client components " +
        "rendered by the flypath router",
    );
  }
  return value;
}

export function usePathname(): string {
  return useNavigation().pathname;
}

export function useParams<P extends Pattern = never>(): RouteParams<P> {
  return useNavigation().params as RouteParams<P>;
}

export function useSearchParams(): SearchParams {
  return useNavigation().searchParams;
}

export const redirect: typeof serverRedirect = (to) => {
  throw new Error(
    `flypath: redirect("${to}") ran in the browser; redirect() answers a ` +
      "request, so it only works in a server component or a server action",
  );
};

export const notFound: typeof serverNotFound = () => {
  throw new Error(
    "flypath: notFound() ran in the browser; it only works in a server " +
      "component or a server action",
  );
};
