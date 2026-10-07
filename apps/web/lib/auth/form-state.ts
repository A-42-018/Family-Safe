export type FieldErrors = Record<string, string[]>;

/** State returned to `useActionState` forms. Never contains passwords or tokens. */
export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>; // non-secret values to repopulate (email, name)
}

export interface TotpEnrollment { factorId: string; qrCode: string; secret: string }
export interface EnrollState extends FormState { enrollment?: TotpEnrollment }
