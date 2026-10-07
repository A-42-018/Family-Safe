"use server";
// Thin Server Action wrappers: build dependencies, call the service, translate results to UI state/redirects.
// Server Actions are POST-only with Next's Origin/Host check (CSRF defence); all input is re-validated by Zod in the service.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/form-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import * as svc from "./service";

const deps = async (): Promise<svc.FamilyDeps> => ({ supabase: await createSupabaseServerClient() });

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

function finish(r: svc.FamilyResult<unknown>): FormState {
  if (r.ok) {
    revalidatePath("/children");
    revalidatePath("/dashboard");
    if (r.redirectTo) redirect(r.redirectTo); // throws; must stay outside try/catch
    return { ok: true, message: r.message };
  }
  if (r.redirectTo) redirect(r.redirectTo);
  return { ok: false, message: r.message, fieldErrors: r.fieldErrors, values: r.values };
}

export async function createFamilyAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.createFamily(await deps(), { name: str(fd, "name") }));
}
export async function renameFamilyAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.renameFamily(await deps(), { name: str(fd, "name") }));
}
export async function deleteFamilyAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.deleteFamily(await deps(), { confirm: str(fd, "confirm") }));
}
export async function createChildAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.createChild(await deps(), { name: str(fd, "name"), dateOfBirth: str(fd, "dateOfBirth") }));
}
export async function updateChildAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.updateChild(await deps(), { id: str(fd, "id"), name: str(fd, "name"), dateOfBirth: str(fd, "dateOfBirth") }));
}
export async function deleteChildAction(_: FormState, fd: FormData): Promise<FormState> {
  return finish(await svc.deleteChild(await deps(), { id: str(fd, "id"), confirm: str(fd, "confirm") }));
}
