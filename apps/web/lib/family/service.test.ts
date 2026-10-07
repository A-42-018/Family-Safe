import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/ratelimit";
import * as svc from "./service";

const UID = "11111111-1111-4111-8111-111111111111";
const FAM = "22222222-2222-4222-8222-222222222222";
const KID = "33333333-3333-4333-8333-333333333333";
type Err = { code?: string } | null;

/** Chainable PostgREST fake: every builder call returns the same thenable; terminal results are scripted per table+verb. */
function fake(o: {
  user?: { id: string } | null; authError?: boolean;
  family?: { id: string; name: string } | null; familyError?: Err;
  insert?: { data?: unknown; error?: Err }; update?: { data?: unknown[]; error?: Err }; del?: { data?: unknown[]; error?: Err };
} = {}) {
  const calls: { table: string; verb: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    let verb = "select";
    const result = () => {
      if (table === "families" && verb === "select") return { data: o.family === undefined ? { id: FAM, name: "Lees" } : o.family, error: o.familyError ?? null };
      if (verb === "insert") return { data: o.insert?.data ?? { id: KID }, error: o.insert?.error ?? null };
      if (verb === "update") return { data: o.update?.data ?? [{ id: KID }], error: o.update?.error ?? null };
      if (verb === "delete") return { data: o.del?.data ?? [{ id: KID }], error: o.del?.error ?? null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq"]) b[m] = vi.fn((...a: unknown[]) => { calls.push({ table, verb: m, args: a }); return b; });
    for (const m of ["insert", "update", "delete"]) b[m] = vi.fn((...a: unknown[]) => { verb = m; calls.push({ table, verb: m, args: a }); return b; });
    b.maybeSingle = vi.fn(async () => result());
    b.single = vi.fn(async () => result());
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  });
  const auth = {
    getUser: vi.fn().mockResolvedValue(
      o.authError || o.user === null ? { data: { user: null }, error: { message: "x" } } : { data: { user: o.user ?? { id: UID } }, error: null },
    ),
  };
  return { deps: { supabase: { auth, from } as unknown as SupabaseClient } as svc.FamilyDeps, from, calls };
}
const verbs = (c: { calls: { table: string; verb: string; args: unknown[] }[] }, table: string, verb: string) =>
  c.calls.filter((x) => x.table === table && x.verb === verb);

beforeEach(() => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authentication", () => {
  it("every operation requires a verified user and never touches tables without one", async () => {
    const f = fake({ user: null });
    const ops = [
      svc.createFamily(f.deps, { name: "A" }), svc.renameFamily(f.deps, { name: "A" }), svc.deleteFamily(f.deps, { confirm: "delete" }),
      svc.createChild(f.deps, { name: "A" }), svc.updateChild(f.deps, { id: KID, name: "A" }), svc.deleteChild(f.deps, { id: KID, confirm: "delete" }),
    ];
    for (const r of await Promise.all(ops)) expect(r).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(f.from).not.toHaveBeenCalled();
  });
});

describe("createFamily", () => {
  it("validates before any query", async () => {
    const f = fake();
    const r = await svc.createFamily(f.deps, { name: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.name?.[0]).toBeTruthy();
    expect(f.deps.supabase.auth.getUser).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });
  it("inserts with the verified user id as parent (never a client-supplied one)", async () => {
    const f = fake({ family: null });
    const r = await svc.createFamily(f.deps, { name: " The Lees ", parent_id: "attacker" });
    expect(r).toEqual({ ok: true, redirectTo: "/children" });
    expect(verbs(f, "families", "insert")[0]?.args[0]).toEqual({ parent_id: UID, name: "The Lees" });
  });
  it("is idempotent when a family already exists", async () => {
    const f = fake();
    expect(await svc.createFamily(f.deps, { name: "Again" })).toEqual({ ok: true, redirectTo: "/children" });
    expect(verbs(f, "families", "insert")).toHaveLength(0);
  });
  it("db error → generic message, code-only log", async () => {
    const f = fake({ family: null, insert: { error: { code: "42501" } } });
    const r = await svc.createFamily(f.deps, { name: "Secret Family Name" });
    expect(r).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    expect(JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("Secret Family Name");
  });
  it("lookup failure does not create a second family", async () => {
    const f = fake({ familyError: { code: "XX000" } });
    expect((await svc.createFamily(f.deps, { name: "A" })).ok).toBe(false);
    expect(verbs(f, "families", "insert")).toHaveLength(0);
  });
});

describe("renameFamily / deleteFamily", () => {
  it("renames the caller's family only", async () => {
    const f = fake();
    expect(await svc.renameFamily(f.deps, { name: "New" })).toEqual({ ok: true, message: "Family name saved." });
    expect(verbs(f, "families", "update")[0]?.args[0]).toEqual({ name: "New" });
    expect(verbs(f, "families", "eq").some((c) => c.args[1] === FAM)).toBe(true);
  });
  it("no family → asks to create one", async () => {
    expect(await svc.renameFamily(fake({ family: null }).deps, { name: "New" })).toMatchObject({ ok: false, message: "Create your family first." });
  });
  it("0 rows updated → not found", async () => {
    expect(await svc.renameFamily(fake({ update: { data: [] } }).deps, { name: "New" })).toMatchObject({ ok: false, message: "Family not found." });
  });
  it("delete requires the confirm token", async () => {
    const f = fake();
    expect(await svc.deleteFamily(f.deps, {})).toMatchObject({ ok: false });
    expect(await svc.deleteFamily(f.deps, { confirm: "yes" })).toMatchObject({ ok: false });
    expect(verbs(f, "families", "delete")).toHaveLength(0);
  });
  it("deletes and redirects; 0 rows → not found", async () => {
    expect(await svc.deleteFamily(fake().deps, { confirm: "delete" })).toEqual({ ok: true, redirectTo: "/children" });
    expect(await svc.deleteFamily(fake({ del: { data: [] } }).deps, { confirm: "delete" })).toMatchObject({ ok: false, message: "Family not found." });
  });
  it("nothing to delete → ok", async () => {
    const f = fake({ family: null });
    expect(await svc.deleteFamily(f.deps, { confirm: "delete" })).toEqual({ ok: true, redirectTo: "/children" });
    expect(verbs(f, "families", "delete")).toHaveLength(0);
  });
});

describe("createChild", () => {
  it("inserts under the caller's family; ownership keys from input are ignored", async () => {
    const f = fake();
    const r = await svc.createChild(f.deps, { name: " Sam ", dateOfBirth: "2015-05-05", family_id: "attacker", familyId: "attacker" });
    expect(r).toMatchObject({ ok: true, redirectTo: `/children/${KID}`, data: { id: KID } });
    expect(verbs(f, "children", "insert")[0]?.args[0]).toEqual({ family_id: FAM, name: "Sam", date_of_birth: "2015-05-05" });
  });
  it("empty dob stored as null; avatar untouched when not provided", async () => {
    const f = fake();
    await svc.createChild(f.deps, { name: "Sam", dateOfBirth: "" });
    const row = verbs(f, "children", "insert")[0]?.args[0] as Record<string, unknown>;
    expect(row.date_of_birth).toBeNull();
    expect("avatar_url" in row).toBe(false);
  });
  it("invalid input repopulates values, no queries", async () => {
    const f = fake();
    const r = await svc.createChild(f.deps, { name: "", dateOfBirth: "2999-01-01" });
    expect(r).toMatchObject({ ok: false, values: { name: "", dateOfBirth: "2999-01-01" } });
    if (!r.ok) expect(Object.keys(r.fieldErrors ?? {})).toEqual(expect.arrayContaining(["name", "dateOfBirth"]));
    expect(f.from).not.toHaveBeenCalled();
  });
  it("no family → redirect to create one", async () => {
    expect(await svc.createChild(fake({ family: null }).deps, { name: "Sam" })).toMatchObject({ ok: false, redirectTo: "/children" });
  });
  it("RLS/db denial → generic, values preserved", async () => {
    const r = await svc.createChild(fake({ insert: { data: null, error: { code: "42501" } } }).deps, { name: "Sam", dateOfBirth: "2015-05-05" });
    expect(r).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
  });
});

describe("updateChild", () => {
  it("updates by id, only allowed columns, avatar omitted → unchanged", async () => {
    const f = fake();
    const r = await svc.updateChild(f.deps, { id: KID, name: "Sam L", dateOfBirth: "2014-01-02", family_id: "x" });
    expect(r).toEqual({ ok: true, redirectTo: `/children/${KID}` });
    expect(verbs(f, "children", "update")[0]?.args[0]).toEqual({ name: "Sam L", date_of_birth: "2014-01-02" });
    expect(verbs(f, "children", "eq")[0]?.args).toEqual(["id", KID]);
  });
  it("clearing dob sends null", async () => {
    const f = fake();
    await svc.updateChild(f.deps, { id: KID, name: "Sam", dateOfBirth: "" });
    expect((verbs(f, "children", "update")[0]?.args[0] as Record<string, unknown>).date_of_birth).toBeNull();
  });
  it("another parent's / missing id → 0 rows → not found (IDOR)", async () => {
    expect(await svc.updateChild(fake({ update: { data: [] } }).deps, { id: KID, name: "Sam" })).toMatchObject({ ok: false, message: "Child not found.", redirectTo: "/children" });
  });
  it("rejects non-uuid ids before querying", async () => {
    const f = fake();
    expect((await svc.updateChild(f.deps, { id: "1 or 1=1", name: "Sam" })).ok).toBe(false);
    expect(f.from).not.toHaveBeenCalled();
  });
});

describe("deleteChild", () => {
  it("requires confirm + uuid", async () => {
    const f = fake();
    expect((await svc.deleteChild(f.deps, { id: KID })).ok).toBe(false);
    expect((await svc.deleteChild(f.deps, { id: "nope", confirm: "delete" })).ok).toBe(false);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("deletes and redirects to the list", async () => {
    const f = fake();
    expect(await svc.deleteChild(f.deps, { id: KID, confirm: "delete" })).toEqual({ ok: true, redirectTo: "/children" });
    expect(verbs(f, "children", "eq")[0]?.args).toEqual(["id", KID]);
  });
  it("0 rows → not found", async () => {
    expect(await svc.deleteChild(fake({ del: { data: [] } }).deps, { id: KID, confirm: "delete" })).toMatchObject({ ok: false, message: "Child not found." });
  });
});

describe("rate limiting", () => {
  it("throttles writes per user", async () => {
    const f = fake();
    let last: svc.FamilyResult = { ok: true };
    for (let i = 0; i < 61; i++) last = await svc.renameFamily(f.deps, { name: "N" });
    expect(last).toMatchObject({ ok: false, message: expect.stringContaining("Too many") });
  });
});
