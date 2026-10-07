import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/ratelimit";
import * as svc from "./service";

const GOOD = "Str0ng!Passw0rd";
const FACTOR = "6f1d1c1e-8a0b-4c6e-9d3a-1f2e3d4c5b6a";
type AuthErr = { code?: string; status?: number; message?: string } | null;

function fake(o: {
  signUp?: AuthErr; signIn?: AuthErr; user?: object | null; update?: AuthErr; reset?: AuthErr; resend?: AuthErr;
  verify?: AuthErr; unenroll?: AuthErr; factors?: { id: string; status: string }[]; enroll?: { data: unknown; error: AuthErr };
} = {}) {
  const auth = {
    signUp: vi.fn().mockResolvedValue({ data: {}, error: o.signUp ?? null }),
    signInWithPassword: vi.fn().mockResolvedValue(
      o.signIn ? { data: { session: null }, error: o.signIn } : { data: { session: { access_token: "a.b.c" } }, error: null },
    ),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "a.b.c" } } }),
    getUser: vi.fn().mockResolvedValue({ data: { user: o.user === undefined ? { id: "u1" } : o.user } }),
    updateUser: vi.fn().mockResolvedValue({ error: o.update ?? null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: o.reset ?? null }),
    resend: vi.fn().mockResolvedValue({ error: o.resend ?? null }),
    mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { all: o.factors ?? [] } }),
      enroll: vi.fn().mockResolvedValue(o.enroll ?? { data: { id: FACTOR, totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "SECRET" } }, error: null }),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: o.verify ?? null }),
      unenroll: vi.fn().mockResolvedValue({ error: o.unenroll ?? null }),
    },
  };
  const audit = vi.fn().mockResolvedValue(undefined);
  const deps: svc.AuthDeps = { supabase: { auth } as unknown as SupabaseClient, ip: "1.2.3.4", audit };
  return { auth, audit, deps };
}

beforeEach(() => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const signUpInput = { fullName: " Ada ", email: "Ada@Example.com", password: GOOD, confirmPassword: GOOD };

describe("signUp", () => {
  it("validates before touching Supabase and never echoes passwords", async () => {
    const { deps, auth } = fake();
    const r = await svc.signUp(deps, { ...signUpInput, password: "weak", confirmPassword: "weak" });
    expect(r.ok).toBe(false);
    expect(auth.signUp).not.toHaveBeenCalled();
    if (!r.ok) {
      expect(r.fieldErrors?.password?.length).toBeGreaterThan(0);
      expect(JSON.stringify(r)).not.toContain("weak");
      expect(r.values).toEqual({ fullName: " Ada ", email: "Ada@Example.com" });
    }
  });
  it("sends normalized data and redirects to verify-email", async () => {
    const { deps, auth } = fake();
    expect(await svc.signUp(deps, signUpInput)).toEqual({ ok: true, redirectTo: "/verify-email" });
    expect(auth.signUp).toHaveBeenCalledWith({ email: "ada@example.com", password: GOOD, options: { data: { full_name: "Ada" } } });
  });
  it("existing account yields the identical success response (no enumeration)", async () => {
    const fresh = await svc.signUp(fake().deps, signUpInput);
    const dupe = await svc.signUp(fake({ signUp: { code: "user_already_exists", status: 422 } }).deps, signUpInput);
    expect(dupe).toEqual(fresh);
  });
  it("maps weak_password, rate limits and unexpected errors without leaking details", async () => {
    const weak = await svc.signUp(fake({ signUp: { code: "weak_password" } }).deps, signUpInput);
    expect(!weak.ok && weak.fieldErrors?.password).toBeTruthy();
    const limited = await svc.signUp(fake({ signUp: { status: 429 } }).deps, signUpInput);
    expect(!limited.ok && limited.message).toMatch(/Too many/);
    const other = await svc.signUp(fake({ signUp: { code: "unexpected_failure", message: "db password=hunter2" } }).deps, signUpInput);
    expect(JSON.stringify(other)).not.toContain("hunter2");
  });
  it("throttles per IP", async () => {
    const { deps } = fake();
    let last: svc.AuthResult = { ok: true };
    for (let i = 0; i < 11; i++) last = await svc.signUp(deps, signUpInput);
    expect(!last.ok && last.message).toMatch(/Too many/);
  });
});

describe("signIn", () => {
  const creds = { email: "a@b.co", password: "whatever-pass" };

  it("audits LOGIN via the injected recorder and returns the redirect", async () => {
    const { deps, audit } = fake();
    expect(await svc.signIn(deps, creds, "/devices")).toEqual({ ok: true, redirectTo: "/devices" });
    expect(audit).toHaveBeenCalledWith({ accessToken: "a.b.c", method: "password" });
  });
  it("wrong password and unknown account are indistinguishable; no audit on failure", async () => {
    const a = fake({ signIn: { code: "invalid_credentials", status: 400 } });
    const b = fake({ signIn: { code: "user_not_found", status: 400 } });
    const ra = await svc.signIn(a.deps, creds, "/dashboard");
    const rb = await svc.signIn(b.deps, creds, "/dashboard");
    expect(ra).toEqual(rb);
    expect(!ra.ok && ra.message).toBe("Invalid email or password.");
    expect(a.audit).not.toHaveBeenCalled();
    expect(JSON.stringify(ra)).not.toContain(creds.password);
  });
  it("unconfirmed email is routed to verify-email", async () => {
    const r = await svc.signIn(fake({ signIn: { code: "email_not_confirmed" } }).deps, creds, "/dashboard");
    expect(!r.ok && r.redirectTo).toBe("/verify-email");
  });
  it("audit failure never blocks login", async () => {
    const { deps, audit } = fake();
    audit.mockRejectedValue(new Error("audit_http_500"));
    expect(await svc.signIn(deps, creds, "/dashboard")).toEqual({ ok: true, redirectTo: "/dashboard" });
  });
  it("locks an ip+account pair after 5 failures", async () => {
    const { deps, auth } = fake({ signIn: { code: "invalid_credentials" } });
    for (let i = 0; i < 5; i++) await svc.signIn(deps, creds, "/dashboard");
    const r = await svc.signIn(deps, creds, "/dashboard");
    expect(!r.ok && r.message).toMatch(/Too many/);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(5);
  });
  it("rejects malformed input without calling Supabase", async () => {
    const { deps, auth } = fake();
    expect((await svc.signIn(deps, { email: "nope", password: "" }, "/dashboard")).ok).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("signOut / reset / resend", () => {
  it("signs out locally and goes to /login", async () => {
    const { deps, auth } = fake();
    expect(await svc.signOut(deps)).toEqual({ ok: true, redirectTo: "/login" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("password reset answers identically whether or not the account exists or the provider errors", async () => {
    const known = await svc.requestPasswordReset(fake().deps, { email: "a@b.co" });
    const unknown = await svc.requestPasswordReset(fake({ reset: { code: "user_not_found" } }).deps, { email: "z@b.co" });
    const throttled = await svc.requestPasswordReset(fake({ reset: { status: 429 } }).deps, { email: "z@b.co" });
    expect(unknown).toEqual(known);
    expect(throttled).toEqual(known);
    expect(known.ok).toBe(true);
  });
  it("password reset validates email and throttles per IP", async () => {
    expect((await svc.requestPasswordReset(fake().deps, { email: "bad" })).ok).toBe(false);
    const { deps } = fake();
    let last: svc.AuthResult = { ok: true };
    for (let i = 0; i < 6; i++) last = await svc.requestPasswordReset(deps, { email: "a@b.co" });
    expect(!last.ok && last.message).toMatch(/Too many/);
  });
  it("resend is generic and swallows provider errors", async () => {
    const a = await svc.resendVerification(fake().deps, { email: "a@b.co" });
    const b = await svc.resendVerification(fake({ resend: { code: "user_not_found" } }).deps, { email: "a@b.co" });
    expect(b).toEqual(a);
  });
});

describe("updatePassword", () => {
  const input = { password: GOOD, confirmPassword: GOOD };
  it("requires a session (recovery link) and does not call updateUser without one", async () => {
    const { deps, auth } = fake({ user: null });
    const r = await svc.updatePassword(deps, input);
    expect(!r.ok && r.redirectTo).toBe("/forgot-password");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates, revokes other sessions and redirects", async () => {
    const { deps, auth } = fake();
    expect(await svc.updatePassword(deps, input)).toEqual({ ok: true, redirectTo: "/dashboard" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });
  it("enforces policy and maps provider errors", async () => {
    const { deps, auth } = fake();
    expect((await svc.updatePassword(deps, { password: "weak", confirmPassword: "weak" })).ok).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
    const same = await svc.updatePassword(fake({ update: { code: "same_password" } }).deps, input);
    expect(!same.ok && same.fieldErrors?.password).toBeTruthy();
  });
});

describe("MFA", () => {
  it("enroll clears abandoned unverified factors and returns QR + secret", async () => {
    const { deps, auth } = fake({ factors: [{ id: "old", status: "unverified" }, { id: "keep", status: "verified" }] });
    const r = await svc.enrollTotp(deps);
    expect(auth.mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(r.ok && r.data).toEqual({ factorId: FACTOR, qrCode: "data:image/svg+xml;utf8,<svg/>", secret: "SECRET" });
  });
  it("enroll requires a signed-in user", async () => {
    const r = await svc.enrollTotp(fake({ user: null }).deps);
    expect(!r.ok && r.redirectTo).toBe("/login");
  });
  it("login challenge audits mfa_totp; enrollment verification does not", async () => {
    const login = fake();
    expect(await svc.verifyTotp(login.deps, { factorId: FACTOR, code: "123456" }, "login", "/dashboard")).toEqual({ ok: true, redirectTo: "/dashboard" });
    expect(login.audit).toHaveBeenCalledWith({ accessToken: "a.b.c", method: "mfa_totp" });
    const enroll = fake();
    await svc.verifyTotp(enroll.deps, { factorId: FACTOR, code: "123456" }, "enroll", "/settings/security");
    expect(enroll.audit).not.toHaveBeenCalled();
  });
  it("bad code is generic; malformed code never reaches Supabase", async () => {
    const { deps, auth } = fake({ verify: { code: "mfa_verification_failed" } });
    const bad = await svc.verifyTotp(deps, { factorId: FACTOR, code: "000000" }, "login", "/dashboard");
    expect(!bad.ok && bad.message).toBe("Invalid or expired code. Please try again.");
    auth.mfa.challengeAndVerify.mockClear();
    expect((await svc.verifyTotp(deps, { factorId: FACTOR, code: "12ab56" }, "login", "/dashboard")).ok).toBe(false);
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it("brute force on the code is throttled per user", async () => {
    const { deps } = fake({ verify: { code: "mfa_verification_failed" } });
    let last: svc.AuthResult = { ok: true };
    for (let i = 0; i < 11; i++) last = await svc.verifyTotp(deps, { factorId: FACTOR, code: "000000" }, "login", "/dashboard");
    expect(!last.ok && last.message).toMatch(/Too many/);
  });
  it("unauthenticated challenge/unenroll are rejected", async () => {
    expect((await svc.verifyTotp(fake({ user: null }).deps, { factorId: FACTOR, code: "123456" }, "login", "/dashboard")).ok).toBe(false);
    const { deps, auth } = fake({ user: null });
    expect((await svc.unenrollTotp(deps, { factorId: FACTOR })).ok).toBe(false);
    expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  });
  it("unenroll validates the factor id and reports provider refusal", async () => {
    expect((await svc.unenrollTotp(fake().deps, { factorId: "x" })).ok).toBe(false);
    expect((await svc.unenrollTotp(fake({ unenroll: { code: "insufficient_aal" } }).deps, { factorId: FACTOR })).ok).toBe(false);
    expect(await svc.unenrollTotp(fake().deps, { factorId: FACTOR })).toEqual({ ok: true, redirectTo: "/settings/security" });
  });
});
