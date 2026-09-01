import type { Mode, Navigate } from "./types.ts";

export type Run = (
  to: string,
  params: unknown,
  mode: Mode | undefined,
  permanent: boolean,
) => void;

type Call = (to: string, ...args: readonly unknown[]) => void;

export function makeNavigate(run: Run): Navigate {
  const call =
    (mode: Mode | undefined, permanent: boolean): Call =>
    (to, ...args) =>
      run(to, args[0], mode, permanent);

  return Object.assign(call(undefined, false), {
    push: call("push", false),
    replace: call("replace", false),
    permanent: call("replace", true),
  }) as unknown as Navigate;
}
