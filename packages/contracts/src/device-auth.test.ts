import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefreshToken, REFRESH_TOKEN_LENGTH, refreshRequestSchema, refreshResponseSchema } from "./device-auth";

const TOKEN = "A".repeat(43);
const ID = "d0000000-0000-4000-8000-0000000000aa";

describe("refreshRequestSchema", () => {
  it("accepts exactly a 43-char base64url token", () => {
    expect(refreshRequestSchema.safeParse({ refresh_token: TOKEN }).success).toBe(true);
    expect(refreshRequestSchema.safeParse({ refresh_token: "aZ09-_".repeat(7) + "a" }).success).toBe(true);
  });
  it("rejects wrong length, padding, other alphabets, non-strings and missing token", () => {
    for (const t of ["", "short", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "+", "A".repeat(42) + "/", "A".repeat(42) + " ", 123, null, undefined]) {
      expect(refreshRequestSchema.safeParse({ refresh_token: t }).success).toBe(false);
    }
    expect(refreshRequestSchema.safeParse({}).success).toBe(false);
  });
  it("is strict: no device id, status or credential id can ride along", () => {
    expect(refreshRequestSchema.safeParse({ refresh_token: TOKEN, device_id: ID }).success).toBe(false);
    expect(refreshRequestSchema.safeParse({ refresh_token: TOKEN, cid: ID }).success).toBe(false);
  });
  it("isRefreshToken agrees with the schema", () => {
    expect(isRefreshToken(TOKEN)).toBe(true);
    expect(isRefreshToken("A".repeat(42))).toBe(false);
  });
});

describe("refreshResponseSchema", () => {
  const ok = { device_id: ID, token_type: "Bearer", access_token: "a.b.c", access_expires_in: 900, refresh_token: TOKEN, refresh_expires_at: "2026-11-01T00:00:00.000Z" };
  it("accepts the documented shape", () => expect(refreshResponseSchema.safeParse(ok).success).toBe(true));
  it("rejects a malformed refresh token, non-Bearer type and non-positive lifetime", () => {
    expect(refreshResponseSchema.safeParse({ ...ok, refresh_token: "x" }).success).toBe(false);
    expect(refreshResponseSchema.safeParse({ ...ok, token_type: "Basic" }).success).toBe(false);
    expect(refreshResponseSchema.safeParse({ ...ok, access_expires_in: 0 }).success).toBe(false);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-auth.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-auth.ts", import.meta.url), "utf8");
  it("token length and character class match", () => {
    expect(edge).toContain(`export const REFRESH_TOKEN_LENGTH = ${REFRESH_TOKEN_LENGTH};`);
    expect(edge).toContain("[A-Za-z0-9_-]{${REFRESH_TOKEN_LENGTH}}");
  });
  it("request schema stays strict with a single refresh_token field", () => {
    expect(edge).toMatch(/RefreshSchema = z\.object\(\{\s*refresh_token: z\.string\(\)\.length\(REFRESH_TOKEN_LENGTH\)\.regex\(REFRESH_TOKEN_RE\),\s*\}\)\.strict\(\)/);
  });
  it("the Edge refresh-token generator produces the length the contract expects (32 bytes -> 43 base64url chars)", () => {
    const enrollment = readFileSync(new URL("../../../supabase/functions/_shared/enrollment.ts", import.meta.url), "utf8");
    expect(enrollment).toContain("crypto.getRandomValues(new Uint8Array(32))");
    expect(Math.ceil((32 * 8) / 6)).toBe(REFRESH_TOKEN_LENGTH);
  });
});
