import { getRequest } from "../runtime/platform.ts";

/**
 * Context lets middleware and server components pass information down the call
 * stack. Analogous to React's own `Context`.
 */
export type Context<T> = {
  /** Read the value for the request being handled. */
  (): T;
  /** Set the value for the rest of the request. Middleware only. */
  set: (value: T) => void;
};

export type ContextStore = {
  readonly values: Map<unknown, unknown>;
  open: boolean;
};

export function createContextStore(): ContextStore {
  return { values: new Map<unknown, unknown>(), open: true };
}

function store(): ContextStore {
  const request = getRequest();
  if (!request) {
    throw new Error(
      "A context value is only available while the flypath router " +
        "is handling a request, so it reads in a middleware, a server " +
        "component or a server action",
    );
  }
  return request.context;
}

/**
 * Per-request state, set by a middleware and read anywhere below it. Without a
 * `fallback`, reading before anything set it throws.
 */
export function context<T>(fallback: T): Context<T>;
export function context<T>(): Context<T>;
export function context<T>(...fallback: readonly T[]): Context<T> {
  const read = (): T => {
    const { values } = store();
    if (values.has(read)) return values.get(read) as T;
    if (fallback.length > 0) return fallback[0] as T;
    throw new Error(
      "This context was read before anything set it; set it from a " +
        "middleware on this route, or declare it with a fallback as " +
        "context(value)",
    );
  };

  return Object.assign(read, {
    set: (value: T): void => {
      const current = store();
      if (!current.open) {
        throw new Error(
          "context.set() ran outside a middleware; a value set " +
            "while rendering would reach some siblings and not others, so " +
            "it is only allowed while middleware runs",
        );
      }
      current.values.set(read, value);
    },
  });
}
