// Device authentication contracts (Phase 11). Edge Functions mirror the token format and request schema locally
// (they cannot import workspace packages) — keep `supabase/functions/_shared/device-auth.ts` in sync.
import { z } from "zod";

/** Refresh tokens are 32 random bytes, base64url without padding. */
export const REFRESH_TOKEN_LENGTH = 43;
const REFRESH_TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${REFRESH_TOKEN_LENGTH}}$`);

export const isRefreshToken = (token: string): boolean => REFRESH_TOKEN_RE.test(token);

/** Device → POST /functions/v1/device-refresh (unauthenticated; the refresh token is the credential) */
export const refreshRequestSchema = z
  .object({ refresh_token: z.string().length(REFRESH_TOKEN_LENGTH).regex(REFRESH_TOKEN_RE) })
  .strict();

/** Same shape as the enrollment response: the refresh token is ROTATED, the old one is dead after this call. */
export const refreshResponseSchema = z.object({
  device_id: z.string().uuid(),
  token_type: z.literal("Bearer"),
  access_token: z.string(),
  access_expires_in: z.number().int().positive(),
  refresh_token: z.string().length(REFRESH_TOKEN_LENGTH),
  refresh_expires_at: z.string(),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
