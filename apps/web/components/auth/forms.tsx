"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  forgotPasswordAction, mfaChallengeAction, resendVerificationAction, resetPasswordAction, signInAction, signUpAction,
  startTotpEnrollmentAction, verifyTotpEnrollmentAction,
} from "@/lib/auth/actions";
import type { EnrollState, FormState } from "@/lib/auth/form-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "./form-parts";

const INITIAL: FormState = {};
const PASSWORD_HINT = "12+ characters with upper- and lowercase letters, a number and a symbol.";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState(signInAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      {notice && !state.message ? <FormMessage state={{ ok: false, message: notice }} /> : null}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" state={state} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <div className="flex justify-between text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" href="/forgot-password">Forgot password?</Link>
        <Link className="text-primary underline-offset-4 hover:underline" href="/signup">Create account</Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="fullName" label="Your name" autoComplete="name" state={state} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} />
      <Field id="password" label="Password" type="password" autoComplete="new-password" state={state} hint={PASSWORD_HINT} />
      <Field id="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" state={state} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm">
        Already have an account? <Link className="text-primary underline-offset-4 hover:underline" href="/login">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} />
      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
      <p className="text-center text-sm"><Link className="text-primary underline-offset-4 hover:underline" href="/login">Back to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="password" label="New password" type="password" autoComplete="new-password" state={state} hint={PASSWORD_HINT} />
      <Field id="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" state={state} />
      <SubmitButton pendingText="Updating…">Update password</SubmitButton>
    </form>
  );
}

export function ResendVerificationForm() {
  const [state, action] = useActionState(resendVerificationAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email" type="email" autoComplete="email" state={state} />
      <SubmitButton pendingText="Sending…" variant="outline">Resend verification email</SubmitButton>
    </form>
  );
}

export function MfaChallengeForm({ factorId, next }: { factorId: string; next?: string }) {
  const [state, action] = useActionState(mfaChallengeAction, INITIAL);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field id="code" label="6-digit code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} state={state} />
      <SubmitButton pendingText="Verifying…">Verify</SubmitButton>
    </form>
  );
}

export function TotpEnrollment() {
  const [enroll, start, starting] = useActionState<EnrollState>(startTotpEnrollmentAction, {});
  const [verify, verifyAction] = useActionState(verifyTotpEnrollmentAction, INITIAL);
  const e = enroll.enrollment;

  if (!e) {
    return (
      <form action={start} className="space-y-4">
        <FormMessage state={enroll} />
        <Button type="submit" disabled={starting}>{starting ? "Preparing…" : "Set up authenticator app"}</Button>
      </form>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">Scan this QR code with your authenticator app, or enter the secret manually, then confirm with a code.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URI SVG from the Auth server */}
      <img src={e.qrCode} alt="TOTP QR code" width={192} height={192} className="rounded border bg-white p-2" />
      <p className="break-all font-mono text-xs" aria-label="Manual setup secret">{e.secret}</p>
      <form action={verifyAction} className="space-y-4" noValidate>
        <FormMessage state={verify} />
        <input type="hidden" name="factorId" value={e.factorId} />
        <Field id="code" label="6-digit code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} state={verify} />
        <SubmitButton pendingText="Verifying…">Turn on two-step verification</SubmitButton>
      </form>
    </div>
  );
}
