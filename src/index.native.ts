import { useFormStatus as nativeUseFormStatus } from "./components/native/form-status.ts";
import type { FormStatus } from "./runtime/form-status.ts";

export * from "./index.ts";
export type { FormStatus } from "./runtime/form-status.ts";

export function useFormStatus(): FormStatus {
  return nativeUseFormStatus();
}
