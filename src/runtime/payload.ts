import type { ReactNode } from "react";

export type RscPayload = {
  root: ReactNode;
  fragments?: Record<string, ReactNode>;
  returnValue?: unknown;
  formState?: unknown;
};
