// FCM HTTP v1 sender (Phase 20a-3). Sends exactly one kind of message: a data-only wake-up `{ type: "SYNC", cmd_id }`
// (prompt §4/§41: FCM is a signal, never data, never an instruction). The service account comes from the Edge secret
// `FCM_SERVICE_ACCOUNT_JSON`; nothing here logs a token, a key or a response body. OAuth uses Web Crypto (RS256), so no
// third-party library is needed. The network is injected, so every outcome is testable without Google.
import { z } from "zod";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = (project: string): string => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`;
const ASSERTION_TTL_SECONDS = 3300; // Google accepts at most one hour
const REFRESH_MARGIN_MS = 60_000;

export const FcmServiceAccountSchema = z
  .object({
    client_email: z.string().email(),
    private_key: z.string().includes("BEGIN PRIVATE KEY"),
    project_id: z.string().regex(/^[a-z][a-z0-9-]{4,60}$/),
  })
  .passthrough();
export type FcmServiceAccount = z.infer<typeof FcmServiceAccountSchema>;

/** Parses the secret. Fails with a generic message: the secret itself must never reach a log. */
export function parseServiceAccount(json: string | undefined): FcmServiceAccount {
  try {
    return FcmServiceAccountSchema.parse(JSON.parse(json ?? ""));
  } catch {
    throw new Error("fcm_config_invalid");
  }
}

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const bin = atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RS256 JWT signed with the service account's private key (PKCS#8 PEM). */
export async function signAssertion(sa: FcmServiceAccount, nowSeconds: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + ASSERTION_TTL_SECONDS };
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

/** The wake-up and nothing else: a `data` map with the type and the command id, no `notification`, no rule values. */
export function buildWakeMessage(deviceToken: string, commandId: string): { message: Record<string, unknown> } {
  return {
    message: {
      token: deviceToken,
      data: { type: "SYNC", cmd_id: commandId },
      android: { priority: "HIGH", ttl: "3600s" },
    },
  };
}

/** `sent`: FCM accepted it. `invalid_token`: the device token is dead (forget it). `retry`: try again later. */
export type SendResult = "sent" | "invalid_token" | "retry";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Classifies an FCM error response without ever keeping its text. */
export function classifyFcmError(status: number, body: unknown): SendResult {
  const error = typeof body === "object" && body !== null ? (body as { error?: { status?: unknown; details?: unknown } }).error : undefined;
  const codes = new Set<string>();
  if (typeof error?.status === "string") codes.add(error.status);
  if (Array.isArray(error?.details)) {
    for (const d of error.details) {
      const c = typeof d === "object" && d !== null ? (d as { errorCode?: unknown }).errorCode : undefined;
      if (typeof c === "string") codes.add(c);
    }
  }
  if (status === 404 || codes.has("UNREGISTERED") || codes.has("NOT_FOUND") || codes.has("INVALID_ARGUMENT") || status === 400) return "invalid_token";
  return "retry"; // 401/403 (our credentials), 429 (quota), 5xx, anything unknown
}

/** A sender that keeps its OAuth access token until a minute before it expires. Never throws on network or HTTP errors. */
export function createFcmSender(sa: FcmServiceAccount, fetchImpl: FetchLike = fetch, nowMs: () => number = Date.now) {
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<string | null> {
    if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > nowMs()) return cached.token;
    try {
      const assertion = await signAssertion(sa, Math.floor(nowMs() / 1000));
      const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      });
      if (!res.ok) return null;
      const json = await res.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") return null;
      cached = { token: json.access_token, expiresAtMs: nowMs() + json.expires_in * 1000 };
      return cached.token;
    } catch {
      return null;
    }
  }

  return async function send(deviceToken: string, commandId: string): Promise<SendResult> {
    const bearer = await accessToken();
    if (bearer === null) return "retry";
    try {
      const res = await fetchImpl(SEND_URL(sa.project_id), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify(buildWakeMessage(deviceToken, commandId)),
      });
      if (res.ok) return "sent";
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // a non-JSON error body is simply unknown
      }
      if (res.status === 401 || res.status === 403) cached = null; // our access token was refused: get a new one next time
      return classifyFcmError(res.status, body);
    } catch {
      return "retry";
    }
  };
}
