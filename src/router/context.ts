import type { Context } from "react";
import { createContext, useContext } from "react";

import type { Href, Params } from "./types.ts";

export type Router = {
  push: (href: Href) => void;
  replace: (href: Href) => void;
  back: () => void;
  refresh: () => void;
  switchTab: (key: string) => void;
  prefetch: (href: Href) => void;
};

export type Navigation = {
  pathname: string;
  params: Params;
  router: Router;
};

export const NavigationContext: Context<Navigation | null> =
  createContext<Navigation | null>(null);

function navigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error(
      "flypath: navigation hooks are only available inside client components " +
        "rendered by the flypath router",
    );
  }
  return value;
}

export function useRouter(): Router {
  return navigation().router;
}

export function usePathname(): string {
  return navigation().pathname;
}

export function useParams(): Params {
  return navigation().params;
}
