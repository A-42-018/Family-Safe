// Device authentication primitives (Phase 11). Mirrors packages/contracts `device-auth.ts` (Edge Functions can't
// import workspace packages) — keep the token format and request schema in sync.
import { z } from "zod";

/** Refresh tokens are 32 random bytes, base64url without padding (see `generateRefreshToken`). */
export const REFRESH_TOKEN_LENGTH = 43;
const REFRESH_TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${REFRESH_TOKEN_LENGTH}}$`);

export const RefreshSchema = z.object({
  refresh_token: z.string().length(REFRESH_TOKEN_LENGTH).regex(REFRESH_TOKEN_RE),
}).strict();
