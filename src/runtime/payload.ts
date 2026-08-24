import type { ReactNode } from "react";

export type RscPayload = {
  root: ReactNode;
  returnValue?: unknown;
  formState?: unknown;
};
