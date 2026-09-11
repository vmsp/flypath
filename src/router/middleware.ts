import type { NavigationSignal } from "./navigation.ts";
import { navigationSignal } from "./navigation.ts";

export type Next = () => Promise<void>;

export type Middleware = (
  next: Next,
) => void | Response | Promise<void | Response>;

export function runMiddleware(
  chain: readonly Middleware[],
  render: () => Promise<Response>,
  answer: (signal: NavigationSignal) => Promise<Response>,
): Promise<Response> {
  const step = async (index: number): Promise<Response> => {
    const middleware = chain[index];
    if (!middleware) return render();

    let pending: Promise<Response> | undefined;

    const discard = (): void => {
      void pending?.then((response) => response.body?.cancel()).catch(() => {});
    };

    const next: Next = () => {
      if (pending) {
        throw new Error(
          "A middleware called next() twice; a request has one " +
            "downstream, so it may be called at most once",
        );
      }
      const running = step(index + 1);
      pending = running;
      const done = running.then(() => undefined);
      done.catch(() => {});
      return done;
    };

    let returned: unknown;
    try {
      returned = await middleware(next);
    } catch (error) {
      discard();
      const signal = navigationSignal(error);
      if (!signal) throw error;
      return answer(signal);
    }

    if (returned instanceof Response) {
      discard();
      return returned;
    }
    return pending ?? step(index + 1);
  };

  return step(0);
}
