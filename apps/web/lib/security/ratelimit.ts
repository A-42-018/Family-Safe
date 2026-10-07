// Server-side rate limiting for auth actions. In-memory per instance: a stop-gap with the final interface.
// Phase 31 swaps the store for a shared (Postgres-backed) one. GoTrue also enforces its own limits (config.toml).
export interface RateLimitRule { name: string; limit: number; windowSeconds: number }
export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function checkRateLimit(rule: RateLimitRule, key: string, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_BUCKETS) buckets.clear(); // memory-safety valve
  }
  const k = `${rule.name}:${key}`;
  const b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  b.count++;
  return b.count > rule.limit
    ? { allowed: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) }
    : { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits(): void { buckets.clear(); }

export const AUTH_RULES = {
  loginIp: { name: "login-ip", limit: 20, windowSeconds: 300 },
  loginAccount: { name: "login-account", limit: 5, windowSeconds: 300 },
  signup: { name: "signup", limit: 10, windowSeconds: 900 },
  passwordReset: { name: "password-reset", limit: 5, windowSeconds: 900 },
  resend: { name: "resend-verification", limit: 5, windowSeconds: 900 },
  mfa: { name: "mfa", limit: 10, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** Family/child writes, keyed by the verified user id. */
export const FAMILY_RULES = {
  write: { name: "family-write", limit: 60, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** Screen-time rule saves (Phase 17b), keyed by the verified user id. */
export const DEVICE_RULES = {
  write: { name: "device-rules-write", limit: 30, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** Per-app restriction saves (Phase 18b), keyed by the verified user id. Own allowance: blocking several apps in a row must not eat the rules budget. */
export const APP_RULES = {
  write: { name: "app-rules-write", limit: 60, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** Marking notifications read (Phase 29b), keyed by the verified user id. */
export const NOTIFICATIONS = {
  write: { name: "notifications-write", limit: 60, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** Schedule and time-zone saves/deletes (Phase 19b), keyed by the verified user id. Own allowance, like app rules. */
export const SCHEDULES = {
  write: { name: "schedules-write", limit: 60, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

/** First hop of x-forwarded-for (set by the trusted reverse proxy) or x-real-ip. Never used for authorization. */
export function getClientIp(h: { get(name: string): string | null }): string {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("x-real-ip")?.trim() || "unknown";
}
