import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildQrPayload, createPairingRequestSchema, createPairingResponseSchema, formatPairingCode, isPairingCode,
  normalizePairingCode, pairingCodeSchema, parseQrPayload, PAIRING_ALPHABET, PAIRING_CODE_LENGTH,
  DEVICE_ACCESS_TTL_SECONDS, DEVICE_REFRESH_TTL_SECONDS, PAIRING_TTL_SECONDS, QR_SCHEME,
  redeemPairingRequestSchema, redeemPairingResponseSchema, revokeDeviceFormSchema, revokeDeviceRequestSchema,
} from "./enrollment";

const ID = "6f1d1c1e-8a0b-4c6e-9d3a-1f2e3d4c5b6a";
const CODE = "0123456789ABCDEF".replace("I", "1"); // 16 valid chars

describe("pairing code", () => {
  it("alphabet is Crockford base32 with 32 unique symbols", () => {
    expect(PAIRING_ALPHABET).toHaveLength(32);
    expect(new Set(PAIRING_ALPHABET).size).toBe(32);
    for (const bad of "ILOU") expect(PAIRING_ALPHABET.includes(bad)).toBe(false);
  });
  it("normalizes case, separators and Crockford aliases", () => {
    expect(normalizePairingCode("abcd-efgh jkmn\tpqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizePairingCode("oO1lI")).toBe("00111");
  });
  it("accepts exactly 16 valid symbols", () => {
    expect(isPairingCode("0123456789ABCDEF")).toBe(true);
    expect(isPairingCode("0123456789ABCDE")).toBe(false);
    expect(isPairingCode("0123456789ABCDEFG")).toBe(false);
    expect(isPairingCode("0123456789ABCDEU")).toBe(false); // U is not in the alphabet
    expect(isPairingCode("0123456789abcdef")).toBe(false); // must be normalized first
  });
  it("schema normalizes then validates", () => {
    expect(pairingCodeSchema.parse(" 0123-4567-89ab-cdef ")).toBe("0123456789ABCDEF");
    expect(pairingCodeSchema.parse("O123-4567-89ab-cdef")).toBe("0123456789ABCDEF");
    expect(pairingCodeSchema.safeParse("short").success).toBe(false);
    expect(pairingCodeSchema.safeParse("0123-4567-89ab-cdeU").success).toBe(false);
    expect(pairingCodeSchema.safeParse("x".repeat(65)).success).toBe(false);
    expect(pairingCodeSchema.safeParse(undefined).success).toBe(false);
    expect(pairingCodeSchema.safeParse(1234567890123456).success).toBe(false);
  });
  it("formats in groups of four and round-trips through normalize", () => {
    expect(formatPairingCode("0123456789ABCDEF")).toBe("0123-4567-89AB-CDEF");
    expect(normalizePairingCode(formatPairingCode("0123456789ABCDEF"))).toBe("0123456789ABCDEF");
    expect(PAIRING_CODE_LENGTH).toBe(16);
  });
});

describe("QR payload", () => {
  it("round-trips", () => {
    const p = buildQrPayload("0123-4567-89AB-CDEF");
    expect(p).toBe("familysafe://enroll?c=0123456789ABCDEF");
    expect(parseQrPayload(p)).toBe("0123456789ABCDEF");
  });
  it.each([
    "", "https://evil.example/enroll?c=0123456789ABCDEF", "familysafe://enroll", "familysafe://enroll?c=",
    "familysafe://enroll?c=SHORT", "familysafe://other?c=0123456789ABCDEF", "familysafe://enroll?x=0123456789ABCDEF",
  ])("rejects %j", (p) => expect(parseQrPayload(p)).toBeNull());
  it("normalizes a hand-edited payload", () => {
    expect(parseQrPayload("familysafe://enroll?c=0123-4567-89ab-cdef")).toBe("0123456789ABCDEF");
  });
});

describe("create request", () => {
  it("needs a uuid child_id and rejects extra keys", () => {
    expect(createPairingRequestSchema.safeParse({ child_id: ID }).success).toBe(true);
    expect(createPairingRequestSchema.safeParse({ child_id: "nope" }).success).toBe(false);
    expect(createPairingRequestSchema.safeParse({}).success).toBe(false);
    expect(createPairingRequestSchema.safeParse({ child_id: ID, family_id: ID }).success).toBe(false);
  });
  it("response schema", () => {
    expect(createPairingResponseSchema.safeParse({ pairing_code: "0123-4567-89AB-CDEF", qr_payload: "x", expires_at: "2026-01-01T00:00:00Z", expires_in: 600 }).success).toBe(true);
    expect(createPairingResponseSchema.safeParse({ pairing_code: "x", qr_payload: "x", expires_at: "x", expires_in: 0 }).success).toBe(false);
  });
});

describe("redeem request", () => {
  const base = { code: CODE, device_name: "  Pixel 8 " };
  it("accepts the minimum and trims", () => {
    const r = redeemPairingRequestSchema.parse(base);
    expect(r.device_name).toBe("Pixel 8");
    expect(r.code).toBe("0123456789ABCDEF");
  });
  it("accepts optional device info", () => {
    expect(redeemPairingRequestSchema.safeParse({ ...base, manufacturer: "Google", model: "Pixel 8", android_version: "15", app_version: "0.1.0" }).success).toBe(true);
  });
  it("enforces column limits", () => {
    expect(redeemPairingRequestSchema.safeParse({ ...base, device_name: "" }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, device_name: "   " }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, device_name: "x".repeat(101) }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, device_name: "x".repeat(100) }).success).toBe(true);
    expect(redeemPairingRequestSchema.safeParse({ ...base, manufacturer: "x".repeat(101) }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, model: "x".repeat(101) }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, android_version: "x".repeat(33) }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ ...base, app_version: "x".repeat(33) }).success).toBe(false);
  });
  it("rejects unknown keys (no mass assignment of child_id, status, ...)", () => {
    for (const extra of [{ child_id: ID }, { enrollment_status: "ENROLLED" }, { device_id: ID }, { fcm_token: "x".repeat(40) }]) {
      expect(redeemPairingRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });
  it("requires code and device_name", () => {
    expect(redeemPairingRequestSchema.safeParse({ device_name: "x" }).success).toBe(false);
    expect(redeemPairingRequestSchema.safeParse({ code: CODE }).success).toBe(false);
  });
  it("response schema", () => {
    const ok = { device_id: ID, token_type: "Bearer", access_token: "a.b.c", access_expires_in: 900, refresh_token: "r", refresh_expires_at: "2026-01-01T00:00:00Z" };
    expect(redeemPairingResponseSchema.safeParse(ok).success).toBe(true);
    expect(redeemPairingResponseSchema.safeParse({ ...ok, token_type: "Basic" }).success).toBe(false);
  });
});

describe("revoke request", () => {
  it("needs a uuid device_id and nothing else", () => {
    expect(revokeDeviceRequestSchema.safeParse({ device_id: ID }).success).toBe(true);
    expect(revokeDeviceRequestSchema.safeParse({ device_id: "x" }).success).toBe(false);
    expect(revokeDeviceRequestSchema.safeParse({ device_id: ID, child_id: ID }).success).toBe(false);
  });
});

describe("revoke form", () => {
  it("needs the explicit confirm token", () => {
    expect(revokeDeviceFormSchema.safeParse({ device_id: ID, confirm: "revoke" }).success).toBe(true);
    expect(revokeDeviceFormSchema.safeParse({ device_id: ID }).success).toBe(false);
    expect(revokeDeviceFormSchema.safeParse({ device_id: ID, confirm: "delete" }).success).toBe(false);
    expect(revokeDeviceFormSchema.safeParse({ device_id: "x", confirm: "revoke" }).success).toBe(false);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/enrollment.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/enrollment.ts", import.meta.url), "utf8");
  const num = (name: string) => {
    const m = new RegExp(`export const ${name} = ([^;]+);`).exec(edge);
    if (!m) throw new Error(`missing ${name}`);
    return Function(`"use strict"; return (${m[1]});`)() as number;
  };
  it("alphabet, code length, TTLs and QR scheme match", () => {
    expect(edge).toContain(`export const PAIRING_ALPHABET = "${PAIRING_ALPHABET}";`);
    expect(edge).toContain(`export const QR_SCHEME = "${QR_SCHEME}";`);
    expect(num("PAIRING_CODE_LENGTH")).toBe(PAIRING_CODE_LENGTH);
    expect(num("PAIRING_TTL_SECONDS")).toBe(PAIRING_TTL_SECONDS);
    expect(num("DEVICE_ACCESS_TTL_SECONDS")).toBe(DEVICE_ACCESS_TTL_SECONDS);
    expect(num("DEVICE_REFRESH_TTL_SECONDS")).toBe(DEVICE_REFRESH_TTL_SECONDS);
  });
  it("request schemas stay strict and share the same column limits", () => {
    for (const frag of ["CreatePairingSchema = z.object({ child_id: uuid }).strict()", "RevokeDeviceSchema = z.object({ device_id: uuid }).strict()",
      "device_name: z.string().trim().min(1).max(100)", "manufacturer: optionalText(100)", "model: optionalText(100)",
      "android_version: optionalText(32)", "app_version: optionalText(32)"]) expect(edge).toContain(frag);
    expect(edge).toMatch(/RedeemSchema = z\.object\(\{[\s\S]*\}\)\.strict\(\)/);
  });
});
