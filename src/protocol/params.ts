/** Platform a Metro client is requesting a bundle for. */
export const PLATFORM_PARAM = "platform";

/** Asks for a flight payload instead of an HTML document. */
export const FLIGHT_PARAM = "__flight";

/** Metro bundle mode; `"false"` requests a production bundle. */
export const DEV_PARAM = "dev";

/** Whether a param is flypath's own and so hidden from route search. */
export function isInternalParam(key: string): boolean {
  return key === FLIGHT_PARAM;
}
