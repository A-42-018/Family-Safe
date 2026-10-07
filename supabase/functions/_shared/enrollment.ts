// Enrollment primitives (Phase 8). Mirrors packages/contracts `enrollment.ts` (Edge Functions can't import
// workspace packages) — keep the constants, code format and request schemas in sync.
import { z } from "zod";
import { bytesToB64url } from "./auth.ts";

export const PAIRING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
export const PAIRING_CODE_LENGTH = 16; // 80 bits
export const PAIRING_TTL_SECONDS = 600;
export const DEVICE_ACCESS_TTL_SECONDS = 900;
export const DEVICE_REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const QR_SCHEME = "familysafe://enroll";

const enc = new TextEncoder();
const CODE_RE = new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

/** Uniformly random code from the CSPRNG. 32 symbols divide 256 evenly, so `byte & 31` has no modulo bias. */
export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
  let out = "";
  for (const b of bytes) out += PAIRING_ALPHABET[b & 31];
  return out;
}

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}
export const isPairingCode = (normalized: string): boolean => CODE_RE.test(normalized);
export const formatPairingCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code;
export const buildQrPayload = (code: string): string => `${QR_SCHEME}?c=${encodeURIComponent(normalizePairingCode(code))}`;

async function digest(algo: "SHA-256", data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algo, data));
}

/** HMAC-SHA-256(pepper, normalized code) → 32 bytes stored in `pairing_tokens.token_hash`. The DB never sees the code. */
export async function hashPairingCode(code: string, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(normalizePairingCode(code))));
}

/** 256-bit opaque refresh token (base64url, 43 chars). Only its SHA-256 is stored. */
export function generateRefreshToken(): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}
export const hashRefreshToken = (token: string): Promise<Uint8Array> => digest("SHA-256", enc.encode(token));

/** PostgREST bytea input: hex with a `\x` prefix. */
export function toPgBytea(b: Uint8Array): string {
  let hex = "\\x";
  for (const x of b) hex += x.toString(16).padStart(2, "0");
  return hex;
}

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const CreatePairingSchema = z.object({ child_id: uuid }).strict();
export const RevokeDeviceSchema = z.object({ device_id: uuid }).strict();
export const RedeemSchema = z.object({
  code: z.string().max(64).transform(normalizePairingCode).refine(isPairingCode, "Invalid pairing code"),
  device_name: z.string().trim().min(1).max(100),
  manufacturer: optionalText(100),
  model: optionalText(100),
  android_version: optionalText(32),
  app_version: optionalText(32),
}).strict();
