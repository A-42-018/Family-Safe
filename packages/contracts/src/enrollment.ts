// Device enrollment contracts (Phase 8). Shared by the web app and docs; Edge Functions mirror these locally
// (they cannot import workspace packages) — keep `supabase/functions/_shared/enrollment.ts` in sync.
// Limits mirror supabase/migrations/20260929000300_devices.sql.
import { z } from "zod";

/** Crockford base32 (no I, L, O, U): unambiguous when typed by hand. 16 chars = 80 bits of entropy. */
export const PAIRING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 16;
export const PAIRING_TTL_SECONDS = 600;
export const DEVICE_ACCESS_TTL_SECONDS = 900;
export const DEVICE_REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const QR_SCHEME = "familysafe://enroll";

const CODE_RE = new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

/** Uppercase, drop spaces/hyphens, apply Crockford aliases (O→0, I/L→1). Does not validate. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function isPairingCode(normalized: string): boolean {
  return CODE_RE.test(normalized);
}

/** XXXX-XXXX-XXXX-XXXX for display. */
export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export function buildQrPayload(code: string): string {
  return `${QR_SCHEME}?c=${encodeURIComponent(normalizePairingCode(code))}`;
}

/** Extracts a valid, normalized code from a QR payload, or null. */
export function parseQrPayload(payload: string): string | null {
  if (!payload.startsWith(`${QR_SCHEME}?`)) return null;
  const c = new URLSearchParams(payload.slice(QR_SCHEME.length + 1)).get("c");
  if (!c) return null;
  const n = normalizePairingCode(c);
  return isPairingCode(n) ? n : null;
}

const uuid = z.string().uuid("Invalid id");
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const pairingCodeSchema = z
  .string({ required_error: "Pairing code is required" })
  .max(64)
  .transform(normalizePairingCode)
  .refine(isPairingCode, "Invalid pairing code");

/** Parent → POST /functions/v1/enrollment-create */
export const createPairingRequestSchema = z.object({ child_id: uuid }).strict();

export const createPairingResponseSchema = z.object({
  pairing_code: z.string(), // XXXX-XXXX-XXXX-XXXX
  qr_payload: z.string(),
  expires_at: z.string(),
  expires_in: z.number().int().positive(),
});

/** Device → POST /functions/v1/enrollment-redeem (unauthenticated; the code is the credential) */
export const redeemPairingRequestSchema = z
  .object({
    code: pairingCodeSchema,
    device_name: z.string({ required_error: "Device name is required" }).trim().min(1).max(100),
    manufacturer: optionalText(100),
    model: optionalText(100),
    android_version: optionalText(32),
    app_version: optionalText(32),
  })
  .strict();

export const redeemPairingResponseSchema = z.object({
  device_id: z.string().uuid(),
  token_type: z.literal("Bearer"),
  access_token: z.string(),
  access_expires_in: z.number().int().positive(),
  refresh_token: z.string(),
  refresh_expires_at: z.string(),
});

/** Parent → POST /functions/v1/device-revoke */
export const revokeDeviceRequestSchema = z.object({ device_id: uuid }).strict();

/** Web form: revoking needs an explicit confirmation token (a stray POST cannot revoke). */
export const revokeDeviceFormSchema = z.object({ device_id: uuid, confirm: z.literal("revoke") });

export type CreatePairingResponse = z.infer<typeof createPairingResponseSchema>;
export type RedeemPairingRequest = z.infer<typeof redeemPairingRequestSchema>;
export type RedeemPairingResponse = z.infer<typeof redeemPairingResponseSchema>;
