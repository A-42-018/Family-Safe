// Rate-limit STUB (Phase 2). Interface is final; storage is in-memory per isolate and NOT sufficient for production.
// Phase 31 replaces the store with a Postgres-backed `rate_limits` table (atomic upsert) keyed per IP + per principal.
import { ApiError } from "./errors.ts";

export interface RateLimitRule { name: string; limit: number; windowSeconds: number }
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(rule: RateLimitRule, key: string, now = Date.now()): RateLimitResult {
  const k = `${rule.name}:${key}`;
  const b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }
  b.count++;
  const retry = Math.ceil((b.resetAt - now) / 1000);
  return b.count > rule.limit
    ? { allowed: false, remaining: 0, retryAfterSeconds: retry }
    : { allowed: true, remaining: rule.limit - b.count, retryAfterSeconds: 0 };
}

export function enforceRateLimit(rule: RateLimitRule, key: string): void {
  const r = checkRateLimit(rule, key);
  if (!r.allowed) throw new ApiError("rate_limited", "Too many requests", undefined, { "Retry-After": String(r.retryAfterSeconds) });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export function resetRateLimits(): void { buckets.clear(); }

// Planned rules (values finalized in Phase 31)
export const RULES = {
  health: { name: "health", limit: 60, windowSeconds: 60 },
  login: { name: "login", limit: 10, windowSeconds: 300 },
  authEventsIp: { name: "auth-events-ip", limit: 30, windowSeconds: 300 },
  authEventsParent: { name: "auth-events-parent", limit: 10, windowSeconds: 300 },
  pairing: { name: "pairing", limit: 5, windowSeconds: 300 }, // per IP, every redeem attempt counts
  enrollmentIp: { name: "enrollment-ip", limit: 30, windowSeconds: 300 },
  enrollment: { name: "enrollment", limit: 10, windowSeconds: 900 }, // per parent: pairing codes minted
  deviceRevoke: { name: "device-revoke", limit: 20, windowSeconds: 300 }, // per parent
  deviceRefresh: { name: "device-refresh", limit: 60, windowSeconds: 300 }, // per IP, every attempt counts
  heartbeat: { name: "heartbeat", limit: 8, windowSeconds: 900 }, // per device (after auth); period is 15 min, so retries fit
  heartbeatIp: { name: "heartbeat-ip", limit: 120, windowSeconds: 300 }, // per IP, pre-auth (carrier-NAT tolerant)
  deviceInfo: { name: "device-info", limit: 6, windowSeconds: 3600 }, // per device (after auth); the app uploads ~once a day
  deviceInfoIp: { name: "device-info-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  permissions: { name: "permissions", limit: 12, windowSeconds: 3600 }, // per device (after auth); periodic sync + app resume + retries
  permissionsIp: { name: "permissions-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  deviceApps: { name: "device-apps", limit: 12, windowSeconds: 3600 }, // per device (after auth); daily sync + change-triggered uploads + retries
  deviceAppsIp: { name: "device-apps-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  deviceUsage: { name: "device-usage", limit: 12, windowSeconds: 3600 }, // per device (after auth); a few uploads a day + retries
  deviceUsageIp: { name: "device-usage-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  deviceConfig: { name: "device-config", limit: 30, windowSeconds: 3600 }, // per device (after auth); periodic pull + SYNC_CONFIG + retries
  deviceConfigIp: { name: "device-config-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  deviceAppEvents: { name: "device-app-events", limit: 30, windowSeconds: 3600 }, // per device (after auth); small batches, throttled per package on the device
  deviceAppEventsIp: { name: "device-app-events-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  deviceLimitEvents: { name: "device-limit-events", limit: 6, windowSeconds: 3600 }, // per device (after auth); one real report per day + retries
  deviceLimitEventsIp: { name: "device-limit-events-ip", limit: 60, windowSeconds: 300 }, // per IP, pre-auth
  location: { name: "location", limit: 60, windowSeconds: 900 },
  commands: { name: "commands", limit: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
