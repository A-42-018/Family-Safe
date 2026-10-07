"use server";
// Thin Server Action wrappers: read only the known form keys, call the service, translate the result to UI state.
// Server Actions are POST-only with Next's Origin/Host check (CSRF defence); all input is re-validated in the service.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/form-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SCHEDULE_DELETE_KEYS, SCHEDULE_FORM_KEYS, TIMEZONE_FORM_KEYS } from "./schedules";
import { deleteSchedule, saveSchedule, setDeviceTimezone } from "./service";

function pick(fd: FormData, keys: readonly string[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v === "string") raw[k] = v; // files and absent fields are dropped (an unchecked box is simply absent)
  }
  return raw;
}

function refresh(deviceId: string): void {
  revalidatePath(`/devices/${deviceId}/schedules`);
  revalidatePath("/dashboard");
}

export async function saveScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await saveSchedule({ supabase: await createSupabaseServerClient() }, pick(fd, SCHEDULE_FORM_KEYS));
  if (r.ok) {
    refresh(r.deviceId);
    return { ok: true, message: r.message, values: r.values };
  }
  if (r.notFound) notFound(); // throws; must stay outside try/catch
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message, fieldErrors: r.fieldErrors, values: r.values };
}

export async function deleteScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await deleteSchedule({ supabase: await createSupabaseServerClient() }, pick(fd, SCHEDULE_DELETE_KEYS));
  if (r.ok) {
    refresh(r.deviceId);
    return { ok: true, message: r.message };
  }
  if (r.notFound) notFound();
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message };
}

export async function setTimezoneAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await setDeviceTimezone({ supabase: await createSupabaseServerClient() }, pick(fd, TIMEZONE_FORM_KEYS));
  if (r.ok) {
    refresh(r.deviceId);
    return { ok: true, message: r.message, values: r.values };
  }
  if (r.notFound) notFound();
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message, fieldErrors: r.fieldErrors, values: r.values };
}
