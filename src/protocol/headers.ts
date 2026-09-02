/** Platform the request comes from; absent means web. */
export const PLATFORM_HEADER = "x-flypath-platform";

/** Container whose screen content is being fetched. */
export const SCREEN_HEADER = "x-flypath-screen";

/** Container whose surrounding chrome is being fetched. */
export const FRAGMENT_HEADER = "x-flypath-fragment";

/** Marks a speculative fetch that must not be treated as a visit. */
export const PREFETCH_HEADER = "x-flypath-prefetch";

/** Carries the encoded navigation command of a flight response. */
export const NAVIGATE_HEADER = "x-flypath-navigate";

/** Carries the encoded resolved location of a flight response. */
export const LOCATION_HEADER = "x-flypath-location";

/** Server action id on an action POST, for a client-invoked action. */
export const ACTION_HEADER = "x-flypath-action";

/** Project root reported to Metro clients by `/status`. */
export const METRO_PROJECT_ROOT_HEADER = "X-React-Native-Project-Root";

/** Bundle revision id Metro clients use to detect a stale bundle. */
export const METRO_DELTA_ID_HEADER = "X-Metro-Delta-ID";
