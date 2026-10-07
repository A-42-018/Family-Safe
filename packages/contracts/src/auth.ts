// Parent-auth contracts shared by the web app (server actions) and docs. Server is always authoritative.
import { z } from "zod";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72; // GoTrue/bcrypt input limit

export const emailSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .toLowerCase()
  .min(3, "Enter a valid email address")
  .max(320, "Enter a valid email address")
  .email("Enter a valid email address");

/** Mirrors supabase/config.toml: minimum_password_length=12, password_requirements=lower_upper_letters_digits_symbols. */
export const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number")
  .regex(/[^A-Za-z0-9]/, "Include a symbol");

export const fullNameSchema = z
  .string({ required_error: "Name is required" })
  .trim()
  .min(1, "Name is required")
  .max(200, "Name is too long");

const passwordPair = { password: passwordSchema, confirmPassword: z.string() };
const mustMatch = (v: { password: string; confirmPassword: string }) => v.password === v.confirmPassword;
const mismatch = { message: "Passwords do not match", path: ["confirmPassword"] };

export const signUpSchema = z.object({ fullName: fullNameSchema, email: emailSchema, ...passwordPair }).refine(mustMatch, mismatch);

/** Login does NOT re-apply complexity rules (never leak policy history); only bounds. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(PASSWORD_MAX, "Invalid email or password"),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resendVerificationSchema = forgotPasswordSchema;

export const resetPasswordSchema = z.object(passwordPair).refine(mustMatch, mismatch);

export const mfaCodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");
export const mfaVerifySchema = z.object({ factorId: z.string().uuid(), code: mfaCodeSchema });
export const mfaUnenrollSchema = z.object({ factorId: z.string().uuid() });

/** Email-link types accepted by /auth/confirm. */
export const confirmLinkSchema = z.object({
  token_hash: z.string().min(8).max(512).regex(/^[A-Za-z0-9._\-]+$/),
  type: z.enum(["signup", "email", "recovery", "email_change"]),
  next: z.string().max(512).optional(),
});

/** Body of POST /functions/v1/auth-events (called by the web server only, never the browser). */
export const authEventSchema = z.object({
  event: z.literal("LOGIN"),
  method: z.enum(["password", "mfa_totp"]),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AuthEventInput = z.infer<typeof authEventSchema>;
