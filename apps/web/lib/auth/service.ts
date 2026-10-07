// Auth business logic, independent of Next runtime (dependencies injected) so it is unit-testable.
// Rules: validate with Zod first; generic messages (no user enumeration); never log emails/tokens/passwords.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodError } from "zod";
import {
  forgotPasswordSchema, loginSchema, mfaUnenrollSchema, mfaVerifySchema, resendVerificationSchema,
  resetPasswordSchema, signUpSchema,
} from "@familysafe/contracts";
import { AUTH_RULES, checkRateLimit, type RateLimitRule } from "@/lib/security/ratelimit";
import type { FieldErrors, TotpEnrollment } from "./form-state";
import type { LoginMethod } from "./audit";

export interface AuthDeps {
  supabase: SupabaseClient;
  ip: string;
  audit: (input: { accessToken: string; method: LoginMethod }) => Promise<void>;
}

export type AuthResult<T = undefined> =
  | { ok: true; redirectTo?: string; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors; redirectTo?: string; values?: Record<string, string> };

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const tooMany = (): AuthResult => ({ ok: false, message: TOO_MANY });

function limited(rule: RateLimitRule, key: string): boolean {
  return !checkRateLimit(rule, key).allowed;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function invalid(err: ZodError, values?: Record<string, string>): AuthResult {
  return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: err.flatten().fieldErrors as FieldErrors, values };
}

async function bestEffortAudit(deps: AuthDeps, method: LoginMethod): Promise<void> {
  try {
    const { data } = await deps.supabase.auth.getSession(); // token only; identity was just verified by the Auth server
    if (data.session) await deps.audit({ accessToken: data.session.access_token, method });
  } catch (e) {
    console.error("audit_login_failed", e instanceof Error ? e.message : "unknown"); // never blocks login; no PII
  }
}

export async function signUp(deps: AuthDeps, raw: unknown): Promise<AuthResult> {
  const parsed = signUpSchema.safeParse(raw);
  const r = raw as Record<string, unknown> | null;
  const values = { fullName: String(r?.fullName ?? ""), email: String(r?.email ?? "") };
  if (!parsed.success) return invalid(parsed.error, values);
  if (limited(AUTH_RULES.signup, deps.ip)) return tooMany();

  const { fullName, email, password } = parsed.data;
  const { error } = await deps.supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) {
    if (error.code === "weak_password") {
      return { ok: false, message: "Choose a stronger password.", fieldErrors: { password: ["Choose a stronger password"] }, values };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") return tooMany();
    if (error.code !== "user_already_exists" && error.code !== "email_exists") {
      console.error("signup_failed", error.code ?? "unknown");
      return { ok: false, message: "We couldn't create your account. Please try again.", values };
    }
    // Existing account: fall through to the identical success response (no enumeration).
  }
  return { ok: true, redirectTo: "/verify-email" };
}

export async function signIn(deps: AuthDeps, raw: unknown, redirectTo: string): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(raw);
  const email = String((raw as Record<string, unknown> | null)?.email ?? "");
  if (!parsed.success) return { ok: false, message: "Enter your email and password.", values: { email } };
  if (limited(AUTH_RULES.loginIp, deps.ip) || limited(AUTH_RULES.loginAccount, `${deps.ip}:${hash(parsed.data.email)}`)) return tooMany();

  const { data, error } = await deps.supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.session) {
    if (error?.code === "email_not_confirmed") {
      // GoTrue only returns this after the password matched, so it reveals nothing to a guesser.
      return { ok: false, message: "Please verify your email address to continue.", redirectTo: "/verify-email" };
    }
    if (error && (error.status === 429 || error.code === "over_request_rate_limit")) return tooMany();
    return { ok: false, message: "Invalid email or password.", values: { email: parsed.data.email } };
  }
  await bestEffortAudit(deps, "password");
  return { ok: true, redirectTo }; // middleware forces /mfa when a second factor is enrolled
}

export async function signOut(deps: AuthDeps): Promise<AuthResult> {
  await deps.supabase.auth.signOut({ scope: "local" });
  return { ok: true, redirectTo: "/login" };
}

const RESET_MESSAGE = "If an account exists for that address, we've emailed a password reset link.";

export async function requestPasswordReset(deps: AuthDeps, raw: unknown): Promise<AuthResult> {
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  if (limited(AUTH_RULES.passwordReset, deps.ip)) return tooMany();
  const { error } = await deps.supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error) console.error("password_reset_request_failed", error.code ?? "unknown"); // swallowed: identical response
  return { ok: true, message: RESET_MESSAGE };
}

export async function resendVerification(deps: AuthDeps, raw: unknown): Promise<AuthResult> {
  const parsed = resendVerificationSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  if (limited(AUTH_RULES.resend, deps.ip)) return tooMany();
  const { error } = await deps.supabase.auth.resend({ type: "signup", email: parsed.data.email });
  if (error) console.error("resend_verification_failed", error.code ?? "unknown");
  return { ok: true, message: "If that address is awaiting verification, we've sent a new link." };
}

export async function updatePassword(deps: AuthDeps, raw: unknown): Promise<AuthResult> {
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { data: u } = await deps.supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "This link is invalid or has expired. Request a new one.", redirectTo: "/forgot-password" };

  const { error } = await deps.supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { ok: false, message: "Choose a password you haven't used here.", fieldErrors: { password: ["Must differ from your current password"] } };
    if (error.code === "weak_password") return { ok: false, message: "Choose a stronger password.", fieldErrors: { password: ["Choose a stronger password"] } };
    console.error("password_update_failed", error.code ?? "unknown");
    return { ok: false, message: "We couldn't update your password. Request a new reset link and try again." };
  }
  await deps.supabase.auth.signOut({ scope: "others" }); // invalidate every other session
  return { ok: true, redirectTo: "/dashboard" };
}

// ---- MFA (TOTP) ---------------------------------------------------------------------------------------------

export async function enrollTotp(deps: AuthDeps): Promise<AuthResult<TotpEnrollment>> {
  const { data: u } = await deps.supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
  if (limited(AUTH_RULES.mfa, u.user.id)) return tooMany() as AuthResult<TotpEnrollment>;

  // Drop abandoned (unverified) enrollments so friendly names never collide.
  const list = await deps.supabase.auth.mfa.listFactors();
  for (const f of list.data?.all ?? []) if (f.status === "unverified") await deps.supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await deps.supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "FamilySafe",
    friendlyName: `Authenticator ${Date.now().toString(36)}`,
  });
  if (error || !data) {
    console.error("mfa_enroll_failed", error?.code ?? "unknown");
    return { ok: false, message: "We couldn't start setup. Please try again." };
  }
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

/** Verifies a TOTP code for enrollment completion (`enroll`) or the login challenge (`login`). */
export async function verifyTotp(deps: AuthDeps, raw: unknown, purpose: "enroll" | "login", redirectTo: string): Promise<AuthResult> {
  const parsed = mfaVerifySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code from your authenticator app.", fieldErrors: { code: ["Enter the 6-digit code"] } };
  const { data: u } = await deps.supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
  if (limited(AUTH_RULES.mfa, u.user.id)) return tooMany();

  const { error } = await deps.supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return { ok: false, message: "Invalid or expired code. Please try again." };
  if (purpose === "login") await bestEffortAudit(deps, "mfa_totp");
  return { ok: true, redirectTo };
}

export async function unenrollTotp(deps: AuthDeps, raw: unknown): Promise<AuthResult> {
  const parsed = mfaUnenrollSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { data: u } = await deps.supabase.auth.getUser();
  if (!u.user) return { ok: false, message: "Please sign in again.", redirectTo: "/login" };
  const { error } = await deps.supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) return { ok: false, message: "We couldn't remove the authenticator. Verify a code first, then try again." };
  return { ok: true, redirectTo: "/settings/security" };
}
