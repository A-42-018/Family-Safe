"use server";
// Thin Server Action wrappers (Next's Origin/Host check protects against CSRF; input is re-validated by Zod in the service).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/form-state";
import { getPublicEnv } from "@/lib/env";
import { getClientIp } from "@/lib/security/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import * as svc from "./service";
import type { PairingState } from "./state";

async function deps(): Promise<svc.EnrollmentDeps> {
  const { supabaseUrl, anonKey } = getPublicEnv();
  return { supabase: await createSupabaseServerClient(), env: { supabaseUrl, anonKey }, ip: getClientIp(await headers()) };
}

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function createPairingCodeAction(_: PairingState, fd: FormData): Promise<PairingState> {
  const r = await svc.createPairingCode(await deps(), { childId: str(fd, "childId") });
  if (r.ok) return { ok: true, pairing: { code: r.code, expiresAt: r.expiresAt, expiresIn: r.expiresIn } };
  if (r.redirectTo) redirect(r.redirectTo); // throws; must stay outside try/catch
  return { ok: false, message: r.message };
}

export async function revokeDeviceAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await svc.revokeDevice(await deps(), { deviceId: str(fd, "id"), confirm: str(fd, "confirm") });
  if (r.ok) {
    revalidatePath("/children", "layout");
    revalidatePath("/dashboard");
    return { ok: true, message: r.message };
  }
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message };
}
