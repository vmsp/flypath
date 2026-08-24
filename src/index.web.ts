import { useFormStatus as domUseFormStatus } from "react-dom";

import type { FormStatus } from "./runtime/form-status.ts";

export * from "./index.ts";
export type { FormStatus } from "./runtime/form-status.ts";

export function useFormStatus(): FormStatus {
  return domUseFormStatus() as FormStatus;
}
