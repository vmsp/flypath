import type { Context } from "react";
import { createContext } from "react";

import type { FormStatus } from "../../runtime/form-status.ts";
import { IDLE_FORM_STATUS } from "../../runtime/form-status.ts";
import { INHERITED_ROOT } from "../../styles/defaults.ts";
import type { Style } from "./resolve.ts";

export const ThemeContext: Context<Record<string, unknown>> = createContext<
  Record<string, unknown>
>({});

export const InheritedTextContext: Context<Style> = createContext<Style>({
  ...INHERITED_ROOT,
});

export type FormField = {
  read: () => string;
  reset: () => void;
};

export type FormControl = {
  register: (name: string, field: FormField) => () => void;
  submit: (overrideAction?: unknown) => void;
};

export const FormContext: Context<FormControl | null> =
  createContext<FormControl | null>(null);

export const FormStatusContext: Context<FormStatus> =
  createContext<FormStatus>(IDLE_FORM_STATUS);
