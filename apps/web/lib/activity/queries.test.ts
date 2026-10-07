import { describe, expect, it } from "vitest";
import { fetchDeviceActivity } from "./queries";

type Call = { table: string; select: string; eq?: [string, unknown]; in?: [string, unknown[]]; limit?: number; order: string[] };

function client(events: { data?: unknown[]; error?: unknown }, apps: { data?: unknown[]; error?: unknown } = { data: [] }) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      const call: Call = { table, select: "", order: [] };
      calls.push(call);
      const result = table === "device_events" ? events : apps;
      const b: Record<string, unknown> = {
        select: (s: string) => ((call.select = s), b),
        eq: (c: string, v: unknown) => ((call.eq = [c, v]), b),
        in: (c: string, v: unknown[]) => ((call.in = [c, v]), b),
        order: (c: string) => (call.order.push(c), b),
        limit: (n: number) => ((call.limit = n), b),
        then: (res: (v: unknown) => unknown) => res({ data: result.data ?? null, error: result.error ?? null }),
      };
      return b;
    },
  };
  return { supabase: supabase as never, calls };
}
const row = (n: number, type = "DEVICE_ONLINE", metadata: unknown = {}) => ({ id: `e${n}`, event_type: type, metadata, created_at: `2026-10-01T09:0${n % 10}:00Z` });

describe("fetchDeviceActivity", () => {
  it("reads one extra row to know whether more exist and returns only the page", async () => {
    const { supabase, calls } = client({ data: [row(1), row(2), row(3)] });
    const r = await fetchDeviceActivity(supabase, "dev", 2);
    expect(r.events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(r.hasMore).toBe(true);
    expect(calls[0]).toMatchObject({ table: "device_events", eq: ["device_id", "dev"], limit: 3, select: "id,event_type,metadata,created_at" });
    expect(calls[0]?.order).toEqual(["created_at", "id"]);
  });
  it("no more rows means hasMore is false; an empty device is fine", async () => {
    expect((await fetchDeviceActivity(client({ data: [row(1)] }).supabase, "dev", 5)).hasMore).toBe(false);
    const empty = await fetchDeviceActivity(client({ data: [] }).supabase, "dev", 5);
    expect(empty).toEqual({ events: [], hasMore: false, labels: new Map() });
  });
  it("skips unusable rows and never reads app labels when no event names a package", async () => {
    const { supabase, calls } = client({ data: [row(1), { id: "", event_type: "X" }, null] });
    const r = await fetchDeviceActivity(supabase, "dev", 5);
    expect(r.events).toHaveLength(1);
    expect(calls.map((c) => c.table)).toEqual(["device_events"]);
  });
  it("looks labels up only for packages named by the returned events", async () => {
    const { supabase, calls } = client(
      { data: [row(1, "BLOCKED_APP_ATTEMPT", { package_name: "com.video.app" }), row(2, "DEVICE_OFFLINE")] },
      { data: [{ package_name: "com.video.app", label: "Video" }, { package_name: "x", label: "" }, { package_name: 5, label: "no" }] },
    );
    const r = await fetchDeviceActivity(supabase, "dev", 5);
    expect(calls[1]).toMatchObject({ table: "device_apps", eq: ["device_id", "dev"], in: ["package_name", ["com.video.app"]], limit: 1, select: "package_name,label" });
    expect([...r.labels]).toEqual([["com.video.app", "Video"]]);
  });
  it("clamps an absurd limit", async () => {
    const { supabase, calls } = client({ data: [] });
    await fetchDeviceActivity(supabase, "dev", 100000);
    expect(calls[0]?.limit).toBe(201);
    await fetchDeviceActivity(client({ data: [] }).supabase, "dev", 0);
  });
  it("errors are generic and carry no database text", async () => {
    await expect(fetchDeviceActivity(client({ error: { message: "secret db text" } }).supabase, "dev", 5)).rejects.toThrow("activity_lookup_failed");
    await expect(
      fetchDeviceActivity(client({ data: [row(1, "APP_INSTALLED", { package_name: "a.b.c" })] }, { error: { message: "secret" } }).supabase, "dev", 5),
    ).rejects.toThrow("activity_labels_lookup_failed");
  });
});
