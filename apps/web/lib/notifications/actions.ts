"use server";
// Thin Server Action wrappers: read only the known form keys, call the service, then refresh the pages that show the count.
// Server Actions are POST-only with Next's Origin/Host check (CSRF defence); all input is re-validated in the service.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markRead, setPreference } from "./service";

async function run(ids: string[] | null): Promise<void> {
  const r = await markRead({ supabase: await createSupabaseServerClient() }, ids);
  if (!r.ok && r.redirectTo) redirect(r.redirectTo); // throws; stays outside try/catch
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function markAllReadAction(): Promise<void> {
  await run(null);
}

export async function markReadAction(fd: FormData): Promise<void> {
  const id = fd.get("id");
  if (typeof id !== "string" || !isUuid(id)) return;
  await run([id]);
}

/** One form per row: hidden `type` and the wanted `enabled` ("true" | "false"). Anything else is ignored. */
export async function setPreferenceAction(fd: FormData): Promise<void> {
  const type = fd.get("type");
  const enabled = fd.get("enabled");
  if (typeof type !== "string" || (enabled !== "true" && enabled !== "false")) return;
  const r = await setPreference({ supabase: await createSupabaseServerClient() }, { type, enabled: enabled === "true" });
  if (!r.ok && r.redirectTo) redirect(r.redirectTo); // throws; stays outside try/catch
  revalidatePath("/settings");
}
