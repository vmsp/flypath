import type { NavigationSignal } from "./navigation.ts";
import { navigationSignal } from "./navigation.ts";

export type Next = () => Promise<Response>;

export type Middleware = (
  next: Next,
) => void | Response | Promise<void | Response>;

export type Answer = (signal: NavigationSignal) => Promise<Response>;

export function runMiddleware(
  chain: readonly Middleware[],
  render: Next,
  answer: Answer,
): Promise<Response> {
  const step = async (index: number): Promise<Response> => {
    const middleware = chain[index];
    if (!middleware) return render();

    let pending: Promise<Response> | undefined;

    const next: Next = () => {
      if (pending) {
        throw new Error(
          "flypath: a middleware called next() twice; a request has one " +
            "downstream, so it may be called at most once",
        );
      }
      pending = step(index + 1);
      return pending;
    };

    let returned: unknown;
    try {
      returned = await middleware(next);
    } catch (error) {
      const signal = navigationSignal(error);
      if (!signal) throw error;
      return answer(signal);
    }

    if (returned instanceof Response) return returned;
    return pending ?? step(index + 1);
  };

  return step(0);
}
