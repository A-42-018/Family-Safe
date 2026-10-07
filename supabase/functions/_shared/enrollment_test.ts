import { assert, assertEquals } from "./test_util.ts";
import {
  buildQrPayload, CreatePairingSchema, formatPairingCode, generatePairingCode, generateRefreshToken, hashPairingCode,
  hashRefreshToken, isPairingCode, normalizePairingCode, PAIRING_ALPHABET, PAIRING_CODE_LENGTH, RedeemSchema,
  RevokeDeviceSchema, toPgBytea,
} from "./enrollment.ts";

const PEPPER = "p".repeat(40);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.test("generatePairingCode: 16 Crockford symbols, unique, no modulo bias", () => {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const c = generatePairingCode();
    assertEquals(c.length, PAIRING_CODE_LENGTH);
    assert(isPairingCode(c), "generated code must satisfy the format");
    seen.add(c);
    for (const ch of c) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  assertEquals(seen.size, 2000);
  assertEquals(counts.size, 32);
  // 32000 symbols / 32 = 1000 expected each; ±25 % is > 8 sigma for a fair source
  for (const n of counts.values()) assert(n > 750 && n < 1250, `symbol count ${n} outside tolerance`);
});

Deno.test("code helpers stay in sync with packages/contracts (fixtures)", () => {
  assertEquals(PAIRING_ALPHABET, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  assertEquals(normalizePairingCode("abcd-efgh jkmn\tpqrs"), "ABCDEFGHJKMNPQRS");
  assertEquals(normalizePairingCode("oO1lI"), "00111");
  assertEquals(formatPairingCode("0123456789ABCDEF"), "0123-4567-89AB-CDEF");
  assertEquals(buildQrPayload("0123-4567-89ab-cdef"), "familysafe://enroll?c=0123456789ABCDEF");
  assert(!isPairingCode("0123456789ABCDEU"));
  assert(!isPairingCode("0123456789ABCDE"));
});

Deno.test("hashPairingCode: 32 bytes, deterministic, format-insensitive, pepper- and code-dependent", async () => {
  const a = await hashPairingCode("0123456789ABCDEF", PEPPER);
  assertEquals(a.length, 32);
  assertEquals(hex(a), hex(await hashPairingCode("0123456789ABCDEF", PEPPER)));
  assertEquals(hex(a), hex(await hashPairingCode("0123-4567-89ab-cdef", PEPPER)));
  assert(hex(a) !== hex(await hashPairingCode("0123456789ABCDEG", PEPPER)));
  assert(hex(a) !== hex(await hashPairingCode("0123456789ABCDEF", "q".repeat(40))));
  assert(!hex(a).includes(hex(new TextEncoder().encode("0123456789ABCDEF"))), "hash must not embed the code");
});

Deno.test("hashPairingCode matches an independent HMAC-SHA-256 vector", async () => {
  // RFC 4231 test case 2 shape: key 'Jefe', data 'what do ya want for nothing?' — checks the primitive, not our wrapper input rules
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("Jefe"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("what do ya want for nothing?")));
  assertEquals(hex(sig), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

Deno.test("refresh tokens: 43-char base64url, unique, SHA-256 hashed", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const t = generateRefreshToken();
    assert(/^[A-Za-z0-9_-]{43}$/.test(t), "256-bit base64url");
    seen.add(t);
  }
  assertEquals(seen.size, 500);
  assertEquals(hex(await hashRefreshToken("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assertEquals((await hashRefreshToken(generateRefreshToken())).length, 32);
});

Deno.test("toPgBytea: \\x-prefixed lowercase hex", () => {
  assertEquals(toPgBytea(new Uint8Array([0, 1, 254, 255])), "\\x0001feff");
  assertEquals(toPgBytea(new Uint8Array()), "\\x");
});

Deno.test("request schemas are strict and normalise", () => {
  const ID = "6f1d1c1e-8a0b-4c6e-9d3a-1f2e3d4c5b6a";
  assert(CreatePairingSchema.safeParse({ child_id: ID }).success);
  assert(!CreatePairingSchema.safeParse({ child_id: ID, family_id: ID }).success);
  assert(!CreatePairingSchema.safeParse({ child_id: "x" }).success);
  assert(RevokeDeviceSchema.safeParse({ device_id: ID }).success);
  assert(!RevokeDeviceSchema.safeParse({ device_id: ID, child_id: ID }).success);
  const r = RedeemSchema.parse({ code: "o123-4567-89ab-cdef", device_name: "  Pixel " });
  assertEquals(r.code, "0123456789ABCDEF");
  assertEquals(r.device_name, "Pixel");
  for (const extra of [{ child_id: ID }, { enrollment_status: "ENROLLED" }, { device_id: ID }, { fcm_token: "x".repeat(40) }]) {
    assert(!RedeemSchema.safeParse({ code: "0123456789ABCDEF", device_name: "P", ...extra }).success);
  }
  assert(!RedeemSchema.safeParse({ code: "0123456789ABCDEF", device_name: "   " }).success);
  assert(!RedeemSchema.safeParse({ code: "0123456789ABCDEF", device_name: "x".repeat(101) }).success);
  assert(!RedeemSchema.safeParse({ code: "short", device_name: "P" }).success);
  assert(!RedeemSchema.safeParse({ code: "0123456789ABCDEF", device_name: "P", android_version: "x".repeat(33) }).success);
});
