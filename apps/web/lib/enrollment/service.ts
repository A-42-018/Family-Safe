// Enrollment orchestration for the web app (Phase 8). Runs on the Next SERVER only: it forwards the signed-in parent's
// own access token to the Edge Functions, which verify it, enforce ownership and write the audit rows. The browser
// never sees a token or a service key, and pairing codes are never logged or persisted here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPairingRequestSchema, createPairingResponseSchema, revokeDeviceFormSchema } from "@familysafe/contracts";

export interface EnrollmentDeps {
  supabase: SupabaseClient;
  env: { supabaseUrl: string; anonKey: string };
  ip: string;
  fetchImpl?: typeof fetch;
}

export type PairingResult =
  | { ok: true; code: string; expiresAt: string; expiresIn: number }
  | { ok: false; message: string; redirectTo?: string };
export type RevokeResult =
  | { ok: true; message: string }
  | { ok: false; message: string; redirectTo?: string };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const SIGN_IN = "Please sign in again.";

/** Verified identity first (Auth server), then the session's access token to forward. */
async function accessToken(supabase: SupabaseClient): Promise<string | null> {
  const { data: u, error } = await supabase.auth.getUser();
  if (error || !u.user) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function callEdge(
  deps: EnrollmentDeps, fn: "enrollment-create" | "device-revoke", token: string, body: unknown,
): Promise<{ status: number; json: unknown }> {
  const { supabaseUrl, anonKey } = deps.env;
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        apikey: anonKey,
        ...(deps.ip && deps.ip !== "unknown" ? { "x-forwarded-for": deps.ip } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null }; // network / timeout: no details
  }
}

function failFor(op: string, status: number, notFound: string): { ok: false; message: string; redirectTo?: string } {
  console.error(op, `http_${status}`); // status only — never bodies, ids or codes
  if (status === 401 || status === 403) return { ok: false, message: SIGN_IN, redirectTo: "/login" };
  if (status === 404) return { ok: false, message: notFound, redirectTo: "/children" };
  if (status === 429) return { ok: false, message: TOO_MANY };
  return { ok: false, message: GENERIC };
}

const dataOf = (json: unknown): unknown => (json && typeof json === "object" ? (json as { data?: unknown }).data : undefined);

export async function createPairingCode(deps: EnrollmentDeps, raw: { childId?: unknown }): Promise<PairingResult> {
  const parsed = createPairingRequestSchema.safeParse({ child_id: raw?.childId });
  if (!parsed.success) return { ok: false, message: "Child not found.", redirectTo: "/children" };
  const token = await accessToken(deps.supabase);
  if (!token) return { ok: false, message: SIGN_IN, redirectTo: "/login" };

  const { status, json } = await callEdge(deps, "enrollment-create", token, parsed.data);
  if (status !== 201) return failFor("pairing_create_failed", status, "Child not found.");
  const data = createPairingResponseSchema.safeParse(dataOf(json));
  if (!data.success) return failFor("pairing_create_bad_response", 0, "");
  return { ok: true, code: data.data.pairing_code, expiresAt: data.data.expires_at, expiresIn: data.data.expires_in };
}

export async function revokeDevice(deps: EnrollmentDeps, raw: { deviceId?: unknown; confirm?: unknown }): Promise<RevokeResult> {
  const parsed = revokeDeviceFormSchema.safeParse({ device_id: raw?.deviceId, confirm: raw?.confirm });
  if (!parsed.success) {
    const idOk = revokeDeviceFormSchema.shape.device_id.safeParse(raw?.deviceId).success;
    return { ok: false, message: idOk ? "Confirm the revocation to continue." : "Device not found.", ...(idOk ? {} : { redirectTo: "/children" }) };
  }
  const token = await accessToken(deps.supabase);
  if (!token) return { ok: false, message: SIGN_IN, redirectTo: "/login" };

  const { status } = await callEdge(deps, "device-revoke", token, { device_id: parsed.data.device_id });
  if (status !== 200) return failFor("device_revoke_failed", status, "Device not found.");
  return { ok: true, message: "Device access revoked." };
}
