import { useContext } from "react";

import type { FormStatus } from "../../runtime/form-status.ts";
import { FormStatusContext } from "./context.ts";

export function useFormStatus(): FormStatus {
  return useContext(FormStatusContext);
}
