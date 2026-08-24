import type { FormStatus } from "./runtime/form-status.ts";

export * from "./index.ts";
export type { FormStatus } from "./runtime/form-status.ts";

export function useFormStatus(): FormStatus {
  throw new Error(
    "flypath: useFormStatus is only available inside client components",
  );
}
