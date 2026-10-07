import { describe, expect, it } from "vitest";
import { fetchNotifications, fetchPreferences, fetchUnreadCount } from "./queries";

type Call = { table: string; select: string; opts?: unknown; is?: [string, unknown]; limit?: number; order: string[] };
function client(result: { data?: unknown; error?: unknown; count?: unknown }) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      const call: Call = { table, select: "", order: [] };
      calls.push(call);
      const b: Record<string, unknown> = {
        select: (s: string, o?: unknown) => ((call.select = s), (call.opts = o), b),
        is: (c: string, v: unknown) => ((call.is = [c, v]), b),
        order: (c: string) => (call.order.push(c), b),
        limit: (n: number) => ((call.limit = n), b),
        then: (res: (v: unknown) => unknown) => res({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }),
      };
      return b;
    },
  };
  return { supabase: supabase as never, calls };
}
const row = (n: number) => ({ id: `n${n}`, type: "BATTERY_LOW", metadata: {}, created_at: `2026-10-01T09:0${n % 10}:00Z`, read_at: null, devices: { device_name: "Phone" } });

describe("fetchNotifications", () => {
  it("reads one extra row, newest first, and returns only the page", async () => {
    const { supabase, calls } = client({ data: [row(1), row(2), row(3)] });
    const r = await fetchNotifications(supabase, 2);
    expect(r.rows.map((x) => x.id)).toEqual(["n1", "n2"]);
    expect(r.hasMore).toBe(true);
    expect(calls[0]).toMatchObject({ table: "notifications", limit: 3, select: "id,type,metadata,created_at,read_at,devices(device_name)" });
    expect(calls[0]?.order).toEqual(["created_at", "id"]);
  });
  it("a short page has no more; unusable rows are skipped; an absurd limit is clamped", async () => {
    expect((await fetchNotifications(client({ data: [row(1)] }).supabase, 5)).hasMore).toBe(false);
    expect((await fetchNotifications(client({ data: [row(1), { id: "" }, null] }).supabase, 5)).rows).toHaveLength(1);
    const { supabase, calls } = client({ data: [] });
    await fetchNotifications(supabase, 100000);
    expect(calls[0]?.limit).toBe(151);
  });
  it("errors are generic", async () => {
    await expect(fetchNotifications(client({ error: { message: "secret db text" } }).supabase, 5)).rejects.toThrow("notifications_lookup_failed");
  });
});

describe("fetchUnreadCount", () => {
  it("is a head-only exact count of unread rows", async () => {
    const { supabase, calls } = client({ count: 7 });
    expect(await fetchUnreadCount(supabase)).toBe(7);
    expect(calls[0]).toMatchObject({ table: "notifications", select: "id", opts: { count: "exact", head: true }, is: ["read_at", null] });
  });
  it("fails generically when the count is missing or the query fails", async () => {
    await expect(fetchUnreadCount(client({ count: null }).supabase)).rejects.toThrow("notifications_count_failed");
    await expect(fetchUnreadCount(client({ error: { message: "x" }, count: 3 }).supabase)).rejects.toThrow("notifications_count_failed");
  });
});

describe("fetchPreferences", () => {
  it("reads type and enabled only, keeps the usable rows", async () => {
    const { supabase, calls } = client({ data: [{ type: "BATTERY_LOW", enabled: false }, { type: "NOPE", enabled: true }, { type: "EMERGENCY", enabled: "x" }, null] });
    const m = await fetchPreferences(supabase);
    expect([...m]).toEqual([["BATTERY_LOW", false]]);
    expect(calls[0]).toMatchObject({ table: "notification_preferences", select: "type,enabled", limit: 10 });
  });
  it("errors are generic", async () => {
    await expect(fetchPreferences(client({ error: { message: "secret" } }).supabase)).rejects.toThrow("notification_preferences_lookup_failed");
  });
});
