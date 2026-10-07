import { describe, expect, it } from "vitest";
import {
  authEventSchema, confirmLinkSchema, emailSchema, forgotPasswordSchema, loginSchema,
  mfaCodeSchema, mfaVerifySchema, passwordSchema, resetPasswordSchema, signUpSchema,
} from "./auth";

const GOOD = "Str0ng!Passw0rd";

describe("passwordSchema", () => {
  it("accepts a strong password", () => expect(passwordSchema.safeParse(GOOD).success).toBe(true));
  it.each([
    ["Sh0rt!aA", "too short"],
    ["alllowercase1!x", "no uppercase"],
    ["ALLUPPERCASE1!X", "no lowercase"],
    ["NoDigitsHere!!Aa", "no digit"],
    ["NoSymbols1234Aaa", "no symbol"],
    [GOOD + "x".repeat(70), "over 72 chars"],
  ])("rejects %s (%s)", (pw) => expect(passwordSchema.safeParse(pw).success).toBe(false));
  it("accepts exactly 12 and 72 chars", () => {
    expect(passwordSchema.safeParse("Aa1!aaaaaaaa").success).toBe(true);
    expect(passwordSchema.safeParse("Aa1!" + "a".repeat(68)).success).toBe(true);
  });
});

describe("emailSchema", () => {
  it("trims and lowercases", () => expect(emailSchema.parse("  Parent@Example.COM ")).toBe("parent@example.com"));
  it.each(["", "nope", "a@b", "x".repeat(320) + "@e.com"])("rejects %j", (v) => expect(emailSchema.safeParse(v).success).toBe(false));
});

describe("signUpSchema", () => {
  const base = { fullName: " Ada ", email: "ADA@x.io", password: GOOD, confirmPassword: GOOD };
  it("normalizes valid input", () => {
    const r = signUpSchema.parse(base);
    expect([r.fullName, r.email]).toEqual(["Ada", "ada@x.io"]);
  });
  it("flags mismatched confirmation on confirmPassword", () => {
    const r = signUpSchema.safeParse({ ...base, confirmPassword: "different" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.confirmPassword).toBeTruthy();
  });
  it("requires a name", () => expect(signUpSchema.safeParse({ ...base, fullName: "  " }).success).toBe(false));
  it("strips unknown keys (no mass assignment)", () => {
    const r = signUpSchema.parse({ ...base, role: "admin" }) as Record<string, unknown>;
    expect(r.role).toBeUndefined();
  });
});

describe("loginSchema", () => {
  it("does not enforce complexity", () => expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true));
  it("rejects empty password and oversize password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("forgot password needs an email", () => expect(forgotPasswordSchema.safeParse({ email: "bad" }).success).toBe(false));
  it("reset password applies policy + match", () => {
    expect(resetPasswordSchema.safeParse({ password: GOOD, confirmPassword: GOOD }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: "weak", confirmPassword: "weak" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: GOOD, confirmPassword: GOOD + "1" }).success).toBe(false);
  });
  it("mfa code is exactly 6 digits", () => {
    expect(mfaCodeSchema.parse(" 123456 ")).toBe("123456");
    for (const v of ["12345", "1234567", "12345a", "", "１２３４５６"]) expect(mfaCodeSchema.safeParse(v).success).toBe(false);
  });
  it("mfa verify requires uuid factor", () => {
    expect(mfaVerifySchema.safeParse({ factorId: "not-a-uuid", code: "123456" }).success).toBe(false);
    expect(mfaVerifySchema.safeParse({ factorId: "6f1d1c1e-8a0b-4c6e-9d3a-1f2e3d4c5b6a", code: "123456" }).success).toBe(true);
  });
  it("confirm link restricts type and token charset", () => {
    expect(confirmLinkSchema.safeParse({ token_hash: "abcdefgh1234", type: "recovery" }).success).toBe(true);
    expect(confirmLinkSchema.safeParse({ token_hash: "abcdefgh1234", type: "magiclink" }).success).toBe(false);
    expect(confirmLinkSchema.safeParse({ token_hash: "abc def<script>", type: "email" }).success).toBe(false);
  });
  it("auth event only allows LOGIN + known methods", () => {
    expect(authEventSchema.safeParse({ event: "LOGIN", method: "password" }).success).toBe(true);
    expect(authEventSchema.safeParse({ event: "DEVICE_REMOVED", method: "password" }).success).toBe(false);
    expect(authEventSchema.safeParse({ event: "LOGIN", method: "sms" }).success).toBe(false);
  });
});
