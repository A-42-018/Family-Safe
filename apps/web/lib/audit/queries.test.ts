import { describe, expect, it } from "vitest";
import { AUDIT_PAGE_SIZE, parseAuditFilters } from "./audit";
import { fetchAuditPage } from "./queries";

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number) => ({ o_id: id(n), o_action: "LOGIN", o_device_id: null, o_device_name: null, o_metadata: {}, o_ip: null, o_created_at: `2026-10-01T09:${String(59 - (n % 60)).padStart(2, "0")}:00Z` });

function client(result: { data?: unknown; error?: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  return {
    supabase: { rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: result.data ?? null, error: result.error ?? null }) } as never,
    calls,
  };
}

describe("fetchAuditPage", () => {
  it("calls only the list RPC, with the parsed filters and one extra row", async () => {
    const { supabase, calls } = client({ data: [] });
    await fetchAuditPage(supabase, parseAuditFilters({ action: "LOGIN" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("parent_list_audit_logs");
    expect(calls[0]?.args).toMatchObject({ p_action: "LOGIN", p_limit: AUDIT_PAGE_SIZE + 1 });
  });
  it("a full page plus one means an older page exists, keyed on the last shown row", async () => {
    const rows = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => row(i + 1));
    const r = await fetchAuditPage(client({ data: rows }).supabase, parseAuditFilters({}));
    expect(r.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(r.next).toEqual({ at: r.rows[AUDIT_PAGE_SIZE - 1]?.at, id: id(AUDIT_PAGE_SIZE) });
  });
  it("a short page is the last one; empty or odd data is fine", async () => {
    expect((await fetchAuditPage(client({ data: [row(1), row(2)] }).supabase, parseAuditFilters({}))).next).toBeNull();
    expect(await fetchAuditPage(client({ data: [] }).supabase, parseAuditFilters({}))).toEqual({ rows: [], next: null });
    expect(await fetchAuditPage(client({ data: "nope" }).supabase, parseAuditFilters({}))).toEqual({ rows: [], next: null });
    expect((await fetchAuditPage(client({ data: [row(1), { o_id: "bad" }, null] }).supabase, parseAuditFilters({}))).rows).toHaveLength(1);
  });
  it("errors are generic and carry no database text", async () => {
    await expect(fetchAuditPage(client({ error: { message: "secret db text", code: "42501" } }).supabase, parseAuditFilters({}))).rejects.toThrow("audit_lookup_failed");
  });
});
