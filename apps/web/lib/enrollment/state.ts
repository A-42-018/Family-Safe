import type { FormState } from "@/lib/auth/form-state";

/** Result of "Add device". `pairing` holds the one-time code shown to the parent; it is never persisted or logged. */
export interface PairingState extends FormState {
  pairing?: { code: string; expiresAt: string; expiresIn: number };
}
