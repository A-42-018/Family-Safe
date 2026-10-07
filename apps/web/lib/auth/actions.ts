"use server";
// Thin Server Action wrappers: build dependencies, call the service, translate results to UI state/redirects.
// Server Actions are POST-only with Next's built-in Origin/Host check (CSRF defence); all input re-validated by Zod.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicEnv } from "@/lib/env";
import { getClientIp } from "@/lib/security/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAuditRecorder } from "./audit";
import type { EnrollState, FormState } from "./form-state";
import { safeNext } from "./routes";
import * as svc from "./service";

async function deps(): Promise<svc.AuthDeps> {
  const ip = getClientIp(await headers());
  const env = getPublicEnv();
  return { supabase: await createSupabaseServerClient(), ip, audit: createAuditRecorder(env, ip) };
}

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

function finish(r: svc.AuthResult): FormState {
  if (r.redirectTo) redirect(r.redirectTo); // throws; must stay outside try/catch
  return r.ok
    ? { ok: true, message: r.message }
    : { ok: false, message: r.message, fieldErrors: r.fieldErrors, values: r.values };
}

export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.signUp(await deps(), {
    fullName: str(fd, "fullName"), email: str(fd, "email"), password: str(fd, "password"), confirmPassword: str(fd, "confirmPassword"),
  }));
}

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.signIn(await deps(), { email: str(fd, "email"), password: str(fd, "password") }, safeNext(str(fd, "next"))));
}

export async function signOutAction(): Promise<void> {
  finish(await svc.signOut(await deps()));
}

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.requestPasswordReset(await deps(), { email: str(fd, "email") }));
}

export async function resendVerificationAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.resendVerification(await deps(), { email: str(fd, "email") }));
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.updatePassword(await deps(), { password: str(fd, "password"), confirmPassword: str(fd, "confirmPassword") }));
}

export async function mfaChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.verifyTotp(await deps(), { factorId: str(fd, "factorId"), code: str(fd, "code") }, "login", safeNext(str(fd, "next"))));
}

export async function startTotpEnrollmentAction(): Promise<EnrollState> {
  const r = await svc.enrollTotp(await deps());
  if (r.redirectTo) redirect(r.redirectTo);
  return r.ok && r.data ? { ok: true, enrollment: r.data } : { ok: false, message: r.ok ? "Setup failed." : r.message };
}

export async function verifyTotpEnrollmentAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.verifyTotp(await deps(), { factorId: str(fd, "factorId"), code: str(fd, "code") }, "enroll", "/settings/security"));
}

export async function unenrollTotpAction(fd: FormData): Promise<void> {
  const r = await svc.unenrollTotp(await deps(), { factorId: str(fd, "factorId") });
  redirect(r.ok ? "/settings/security" : "/settings/security?error=unenroll");
}
