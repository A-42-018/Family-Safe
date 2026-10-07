// Read side for Server Components. Every read runs as the signed-in parent under RLS, so only their own rows come back.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findFamily } from "./service";

export interface ChildRow {
  id: string;
  name: string;
  dateOfBirth: string | null;
  deviceCount: number;
}
export interface FamilyOverview {
  family: { id: string; name: string } | null;
  children: ChildRow[];
}

type RawChild = { id: string; name: string; date_of_birth: string | null; devices: { count: number }[] | null };
const toRow = (c: RawChild): ChildRow => ({ id: c.id, name: c.name, dateOfBirth: c.date_of_birth, deviceCount: c.devices?.[0]?.count ?? 0 });
const COLUMNS = "id,name,date_of_birth,devices(count)"; // avatar_url is not rendered (CSP img-src 'self' data: blob:)

export async function fetchFamilyOverview(supabase: SupabaseClient): Promise<FamilyOverview> {
  const family = await findFamily(supabase);
  if (family === "error") throw new Error("family_lookup_failed"); // caught by app/(app)/error.tsx (no message shown)
  if (!family) return { family: null, children: [] };
  const { data, error } = await supabase.from("children").select(COLUMNS).order("name", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error("children_lookup_failed");
  return { family, children: ((data ?? []) as unknown as RawChild[]).map(toRow) };
}

export async function fetchChild(supabase: SupabaseClient, id: string): Promise<ChildRow | null> {
  const { data, error } = await supabase.from("children").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("child_lookup_failed");
  return data ? toRow(data as unknown as RawChild) : null;
}

export async function loadFamilyOverview(): Promise<FamilyOverview> {
  return fetchFamilyOverview(await createSupabaseServerClient());
}
export async function loadChild(id: string): Promise<ChildRow | null> {
  return fetchChild(await createSupabaseServerClient(), id);
}
