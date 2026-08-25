import { useContext } from "react";
import type { FormStatus } from "react-dom";

import { FormStatusContext } from "./context.ts";

export function useFormStatus(): FormStatus {
  return useContext(FormStatusContext);
}
