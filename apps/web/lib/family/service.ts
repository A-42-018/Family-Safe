// Family/child business logic, independent of the Next runtime (dependencies injected) so it is unit-testable.
// Ownership is enforced by RLS (supabase/migrations/…000800_rls_policies.sql); this layer additionally treats a
// 0-row result as "not found" (another parent's id is indistinguishable from a missing one) and never logs PII.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodError } from "zod";
import {
  createChildSchema, createFamilySchema, deleteChildSchema, deleteFamilySchema, renameFamilySchema, updateChildSchema,
} from "@familysafe/contracts";
import type { FieldErrors } from "@/lib/auth/form-state";
import { checkRateLimit, FAMILY_RULES } from "@/lib/security/ratelimit";

export interface FamilyDeps { supabase: SupabaseClient }

export type FamilyResult<T = undefined> =
  | { ok: true; redirectTo?: string; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: FieldErrors; redirectTo?: string; values?: Record<string, string> };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY = "Too many changes in a short time. Please wait a few minutes and try again.";
const NO_FAMILY = "Create your family first.";

const fail = (message: string, extra: Partial<Extract<FamilyResult, { ok: false }>> = {}): FamilyResult => ({ ok: false, message, ...extra });
const notFound = (what: string): FamilyResult => fail(`${what} not found.`, { redirectTo: "/children" });

function invalid(err: ZodError, values?: Record<string, string>): FamilyResult {
  return fail("Please fix the highlighted fields.", { fieldErrors: err.flatten().fieldErrors as FieldErrors, values });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Verified identity from the Auth server (not the cookie contents). */
async function requireUser(deps: FamilyDeps): Promise<{ id: string } | FamilyResult> {
  const { data, error } = await deps.supabase.auth.getUser();
  if (error || !data.user) return fail("Please sign in again.", { redirectTo: "/login" });
  return { id: data.user.id };
}
const isResult = (v: { id: string } | FamilyResult): v is FamilyResult => "ok" in v;

const limited = (userId: string): boolean => !checkRateLimit(FAMILY_RULES.write, userId).allowed;

function dbFail(op: string, error: { code?: string }): FamilyResult {
  console.error(op, error.code ?? "unknown"); // code only — never row contents, names or dates of birth
  return fail(GENERIC);
}

/** One family per parent is an app-level rule: always the oldest owned family (no DB uniqueness; see plan.md P7). */
export async function findFamily(supabase: SupabaseClient): Promise<{ id: string; name: string } | null | "error"> {
  const { data, error } = await supabase
    .from("families").select("id,name").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle();
  if (error) { console.error("family_lookup_failed", error.code ?? "unknown"); return "error"; }
  return data as { id: string; name: string } | null;
}

export async function createFamily(deps: FamilyDeps, raw: unknown): Promise<FamilyResult> {
  const parsed = createFamilySchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, { name: str((raw as { name?: unknown } | null)?.name) });
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY);

  const existing = await findFamily(deps.supabase);
  if (existing === "error") return fail(GENERIC);
  if (existing) return { ok: true, redirectTo: "/children" }; // idempotent (double submit / second tab)

  const { error } = await deps.supabase.from("families").insert({ parent_id: user.id, name: parsed.data.name });
  if (error) return dbFail("family_create_failed", error);
  return { ok: true, redirectTo: "/children" };
}

export async function renameFamily(deps: FamilyDeps, raw: unknown): Promise<FamilyResult> {
  const parsed = renameFamilySchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, { name: str((raw as { name?: unknown } | null)?.name) });
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY);

  const family = await findFamily(deps.supabase);
  if (family === "error") return fail(GENERIC);
  if (!family) return fail(NO_FAMILY);

  const { data, error } = await deps.supabase.from("families").update({ name: parsed.data.name }).eq("id", family.id).select("id");
  if (error) return dbFail("family_rename_failed", error);
  if (!data || data.length === 0) return notFound("Family");
  return { ok: true, message: "Family name saved." };
}

export async function deleteFamily(deps: FamilyDeps, raw: unknown): Promise<FamilyResult> {
  if (!deleteFamilySchema.safeParse(raw).success) return fail("Confirm the deletion to continue.");
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY);

  const family = await findFamily(deps.supabase);
  if (family === "error") return fail(GENERIC);
  if (!family) return { ok: true, redirectTo: "/children" };

  // Cascades to children, devices and all their data (FK on delete cascade).
  const { data, error } = await deps.supabase.from("families").delete().eq("id", family.id).select("id");
  if (error) return dbFail("family_delete_failed", error);
  if (!data || data.length === 0) return notFound("Family");
  return { ok: true, redirectTo: "/children" };
}

function childValues(raw: unknown): Record<string, string> {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { name: str(r.name), dateOfBirth: str(r.dateOfBirth) };
}

export async function createChild(deps: FamilyDeps, raw: unknown): Promise<FamilyResult<{ id: string }>> {
  const parsed = createChildSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, childValues(raw));
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY, { values: childValues(raw) });

  const family = await findFamily(deps.supabase);
  if (family === "error") return fail(GENERIC, { values: childValues(raw) });
  if (!family) return fail(NO_FAMILY, { redirectTo: "/children" });

  const row: Record<string, unknown> = { family_id: family.id, name: parsed.data.name, date_of_birth: parsed.data.dateOfBirth };
  if (parsed.data.avatarUrl !== undefined) row.avatar_url = parsed.data.avatarUrl;
  const { data, error } = await deps.supabase.from("children").insert(row).select("id").single();
  if (error || !data) return dbFail("child_create_failed", error ?? {});
  return { ok: true, redirectTo: `/children/${(data as { id: string }).id}`, data: { id: (data as { id: string }).id } };
}

export async function updateChild(deps: FamilyDeps, raw: unknown): Promise<FamilyResult> {
  const parsed = updateChildSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error, childValues(raw));
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY, { values: childValues(raw) });

  const { id, name, dateOfBirth, avatarUrl } = parsed.data;
  const patch: Record<string, unknown> = { name, date_of_birth: dateOfBirth };
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl; // omitted = unchanged
  const { data, error } = await deps.supabase.from("children").update(patch).eq("id", id).select("id");
  if (error) return dbFail("child_update_failed", error);
  if (!data || data.length === 0) return notFound("Child");
  return { ok: true, redirectTo: `/children/${id}` };
}

export async function deleteChild(deps: FamilyDeps, raw: unknown): Promise<FamilyResult> {
  const parsed = deleteChildSchema.safeParse(raw);
  if (!parsed.success) return fail("Confirm the deletion to continue.");
  const user = await requireUser(deps);
  if (isResult(user)) return user;
  if (limited(user.id)) return fail(TOO_MANY);

  // Cascades to the child's devices and all their data.
  const { data, error } = await deps.supabase.from("children").delete().eq("id", parsed.data.id).select("id");
  if (error) return dbFail("child_delete_failed", error);
  if (!data || data.length === 0) return notFound("Child");
  return { ok: true, redirectTo: "/children" };
}
