// Two separate trust domains (docs/SECURITY.md): Parent (Supabase JWT) vs Device (custom HS256 JWT).
// Device tokens carry role=device and MUST be rejected on parent surfaces; parent tokens rejected on device surfaces.
import { ApiError } from "./errors.ts";

export type Principal =
  | { kind: "parent"; parentId: string; email?: string; aal?: "aal1" | "aal2"; sessionId?: string }
  | { kind: "device"; deviceId: string; credentialId?: string };

const enc = new TextEncoder();

export function extractBearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]*)$/.exec(h);
  if (!m) throw new ApiError("unauthorized", "Missing or malformed bearer token");
  return m[1];
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export interface DeviceClaims {
  sub: string; // device_id
  role: "device";
  iat: number;
  exp: number;
  jti?: string;
  cid?: string; // credential id: checked against a live credential on every request (`requireActiveDevice`)
}

/** Sign a device access token (HS256). Issued by `enrollment-redeem` and `device-refresh`. */
export async function signDeviceJwt(
  claims: Omit<DeviceClaims, "iat" | "exp" | "role"> & { ttlSeconds?: number },
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const { ttlSeconds = 900, ...rest } = claims;
  const header = bytesToB64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = bytesToB64url(enc.encode(JSON.stringify({ ...rest, role: "device", iat: now, exp: now + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

/** Verify a device JWT: HS256 only, constant-time signature check, exp/iat, role=device. */
export async function verifyDeviceJwt(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<DeviceClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError("unauthorized", "Invalid token");
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    if (header.alg !== "HS256") throw new Error("alg");
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), b64urlToBytes(s), enc.encode(`${h}.${p}`));
    if (!valid) throw new Error("sig");
    const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Partial<DeviceClaims>;
    if (c.role !== "device" || typeof c.sub !== "string" || typeof c.exp !== "number" || typeof c.iat !== "number") throw new Error("claims");
    if (c.exp <= now) throw new Error("expired");
    if (c.iat > now + 60) throw new Error("iat");
    return c as DeviceClaims;
  } catch {
    throw new ApiError("unauthorized", "Invalid or expired token"); // never reveal which check failed
  }
}

/** Unverified claims peek — ONLY to route/pre-filter before real verification. Never trust its contents on its own. */
export function peekClaims(token: string): Record<string, unknown> | undefined {
  try {
    const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(token.split(".")[1])));
    return c && typeof c === "object" && !Array.isArray(c) ? c as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export function peekRole(token: string): string | undefined {
  const r = peekClaims(token)?.role;
  return typeof r === "string" ? r : undefined;
}

export interface ActiveDeviceDeps {
  secret: string;
  /** Live credential check (`device_authorize`): true only for a non-revoked, non-expired credential of an ENROLLED device. */
  isActive: (deviceId: string, credentialId: string) => Promise<boolean>;
  now?: number;
}

/**
 * Device surface guard — the ONLY way device endpoints (Phase 12+) authenticate. Order matters:
 *  1. HS256 signature, exp/iat, role=device (`verifyDeviceJwt`)
 *  2. `cid` must be present (tokens minted without a credential id are refused)
 *  3. live credential lookup on EVERY request, uncached, so a revoked device is refused immediately
 * Every rejection is the same 401. A failing lookup (database outage) propagates and becomes a sanitized 500 —
 * it is never read as "valid".
 */
export async function requireActiveDevice(req: Request, deps: ActiveDeviceDeps): Promise<Principal & { kind: "device"; credentialId: string }> {
  const claims = await verifyDeviceJwt(extractBearer(req), deps.secret, deps.now);
  if (typeof claims.cid !== "string" || claims.cid.length === 0) throw new ApiError("unauthorized", "Invalid or expired token");
  if (!(await deps.isActive(claims.sub, claims.cid))) throw new ApiError("unauthorized", "Invalid or expired token");
  return { kind: "device", deviceId: claims.sub, credentialId: claims.cid };
}

/**
 * Parent surface pre-check: rejects device tokens outright, before any network verification.
 * Use `requireParent` for the full check.
 */
export function rejectDeviceTokenOnParentSurface(req: Request): string {
  const token = extractBearer(req);
  if (peekRole(token) === "device") throw new ApiError("forbidden", "Device credentials are not valid on this endpoint");
  return token;
}

export interface VerifiedUser { id: string; email?: string }
/** Resolves a Supabase access token to its user via the Auth server, or null if invalid/expired/revoked. Throws only on infrastructure failure. */
export type ParentTokenVerifier = (token: string) => Promise<VerifiedUser | null>;

/**
 * Parent surface guard (Supabase JWT). Order matters:
 *  1. device tokens -> 403 (trust-domain split), verifier never called
 *  2. role must be `authenticated` (anon / service_role keys are not user sessions), exp pre-check
 *  3. Auth-server verification (signature, expiry, session revocation) and `sub` must match the verified user
 * After step 3 the token is authentic, so its `aal` / `session_id` claims can be read safely.
 * Infrastructure failures from the verifier propagate (sanitized to 500 by toErrorResponse), never "valid".
 */
export async function requireParent(
  req: Request,
  verify: ParentTokenVerifier,
  opts: { requireAal2?: boolean; now?: number } = {},
): Promise<Principal & { kind: "parent" }> {
  const token = rejectDeviceTokenOnParentSurface(req);
  const claims = peekClaims(token);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!claims || claims.role !== "authenticated" || typeof claims.sub !== "string" || typeof claims.exp !== "number" || claims.exp <= now) {
    throw new ApiError("unauthorized", "Invalid or expired token");
  }
  const user = await verify(token);
  if (!user || user.id !== claims.sub) throw new ApiError("unauthorized", "Invalid or expired token");

  const aal = claims.aal === "aal2" ? "aal2" : claims.aal === "aal1" ? "aal1" : undefined;
  if (opts.requireAal2 && aal !== "aal2") throw new ApiError("forbidden", "Multi-factor authentication required");
  return {
    kind: "parent",
    parentId: user.id,
    email: user.email,
    aal,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : undefined,
  };
}
