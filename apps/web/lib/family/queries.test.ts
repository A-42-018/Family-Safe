import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChild, fetchFamilyOverview } from "./queries";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

function client(o: { family?: unknown; familyError?: unknown; children?: unknown; childrenError?: unknown; child?: unknown; childError?: unknown }) {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq"]) b[m] = () => b;
    b.maybeSingle = async () => (table === "families" ? { data: o.family ?? null, error: o.familyError ?? null } : { data: o.child ?? null, error: o.childError ?? null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: o.children ?? [], error: o.childrenError ?? null }).then(res);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

describe("fetchFamilyOverview", () => {
  it("no family → empty", async () => expect(await fetchFamilyOverview(client({}))).toEqual({ family: null, children: [] }));
  it("maps children with device counts (missing embed → 0)", async () => {
    const r = await fetchFamilyOverview(client({
      family: { id: "f", name: "Lees" },
      children: [
        { id: "a", name: "Ann", date_of_birth: "2015-01-01", devices: [{ count: 2 }] },
        { id: "b", name: "Bo", date_of_birth: null, devices: [] },
        { id: "c", name: "Cy", date_of_birth: null, devices: null },
      ],
    }));
    expect(r.family).toEqual({ id: "f", name: "Lees" });
    expect(r.children).toEqual([
      { id: "a", name: "Ann", dateOfBirth: "2015-01-01", deviceCount: 2 },
      { id: "b", name: "Bo", dateOfBirth: null, deviceCount: 0 },
      { id: "c", name: "Cy", dateOfBirth: null, deviceCount: 0 },
    ]);
  });
  it("errors throw a fixed message (no db detail)", async () => {
    await expect(fetchFamilyOverview(client({ familyError: { code: "x", message: "secret" } }))).rejects.toThrow("family_lookup_failed");
    await expect(fetchFamilyOverview(client({ family: { id: "f", name: "L" }, childrenError: { message: "secret" } }))).rejects.toThrow("children_lookup_failed");
  });
});

describe("fetchChild", () => {
  it("null when missing/not visible", async () => expect(await fetchChild(client({}), "id")).toBeNull());
  it("maps a row", async () => {
    expect(await fetchChild(client({ child: { id: "a", name: "Ann", date_of_birth: null, devices: [{ count: 1 }] } }), "a")).toEqual({ id: "a", name: "Ann", dateOfBirth: null, deviceCount: 1 });
  });
  it("db error throws fixed message", async () => {
    await expect(fetchChild(client({ childError: { message: "secret" } }), "a")).rejects.toThrow("child_lookup_failed");
  });
});
