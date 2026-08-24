export type FormStatus = {
  pending: boolean;
  data: FormData | null;
  method: string | null;
  action: string | ((formData: FormData) => void | Promise<void>) | null;
};

export const IDLE_FORM_STATUS: FormStatus = {
  pending: false,
  data: null,
  method: null,
  action: null,
};
