import { normalizePath } from "../router/path.ts";

/** Extension a route's flight payload is served at, instead of its document. */
export const FLIGHT_SUFFIX = ".flight";

const INDEX = "/index";

export function isFlightPath(pathname: string): boolean {
  return pathname.endsWith(FLIGHT_SUFFIX);
}

export function flightPath(pathname: string): string {
  const base = normalizePath(pathname);
  return `${base === "/" ? INDEX : base}${FLIGHT_SUFFIX}`;
}

export function documentPath(pathname: string): string {
  if (!isFlightPath(pathname)) return normalizePath(pathname);
  const base = pathname.slice(0, -FLIGHT_SUFFIX.length);
  return base === INDEX ? "/" : normalizePath(base);
}
