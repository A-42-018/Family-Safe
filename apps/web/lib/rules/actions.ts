"use server";
// Thin Server Action wrapper: reads only the known form keys, calls the service, translates the result to UI state.
// Server Actions are POST-only with Next's Origin/Host check (CSRF defence); all input is re-validated in the service.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/form-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RULES_FORM_KEYS } from "./rules";
import { setScreenTimeRules } from "./service";

function formToRaw(fd: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const k of RULES_FORM_KEYS) {
    const v = fd.get(k);
    if (typeof v === "string") raw[k] = v; // files and absent fields are dropped
  }
  return raw;
}

export async function saveScreenTimeRulesAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await setScreenTimeRules({ supabase: await createSupabaseServerClient() }, formToRaw(fd));
  if (r.ok) {
    revalidatePath(`/devices/${r.deviceId}/rules`);
    revalidatePath("/dashboard");
    return { ok: true, message: r.message, values: r.values };
  }
  if (r.notFound) notFound(); // throws; must stay outside try/catch
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message, fieldErrors: r.fieldErrors, values: r.values };
}
