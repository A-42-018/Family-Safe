import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  markReadInputSchema, NOTIFICATION_MARK_READ_MAX_IDS, NOTIFICATION_METADATA_MAX_BYTES, NOTIFICATION_RETENTION_DAYS, NOTIFICATION_TYPES,
  NOTIFICATION_ALWAYS_ON, NOTIFICATION_DEDUPE_MINUTES, NOTIFICATIONS_PER_PARENT_MAX, isAlwaysOn, notificationPreferenceInputSchema, notificationTypeSchema,
} from "./notifications";

const ID = "e0000000-0000-4000-8000-000000000001";

describe("notification types", () => {
  it("are the ten of prompt §49, unique and upper snake case", () => {
    expect(NOTIFICATION_TYPES).toHaveLength(10);
    expect(new Set(NOTIFICATION_TYPES).size).toBe(10);
    for (const t of NOTIFICATION_TYPES) expect(t).toMatch(/^[A-Z][A-Z_]+$/);
    expect(notificationTypeSchema.safeParse("EMERGENCY").success).toBe(true);
    expect(notificationTypeSchema.safeParse("emergency").success).toBe(false);
    expect(notificationTypeSchema.safeParse("LOGIN").success).toBe(false);
  });
});

describe("notificationPreferenceInputSchema", () => {
  it("accepts a known type and a boolean", () => {
    expect(notificationPreferenceInputSchema.safeParse({ type: "BATTERY_LOW", enabled: false }).success).toBe(true);
  });
  it.each([
    ["unknown type", { type: "NOPE", enabled: true }],
    ["missing enabled", { type: "BATTERY_LOW" }],
    ["string enabled", { type: "BATTERY_LOW", enabled: "true" }],
    ["extra key", { type: "BATTERY_LOW", enabled: true, device_id: ID }],
    ["null", null],
  ])("rejects %s", (_n, body) => expect(notificationPreferenceInputSchema.safeParse(body).success).toBe(false));
});

describe("markReadInputSchema", () => {
  it("accepts null (all unread) and a list of ids", () => {
    expect(markReadInputSchema.safeParse({ ids: null }).success).toBe(true);
    expect(markReadInputSchema.safeParse({ ids: [ID] }).success).toBe(true);
    expect(markReadInputSchema.safeParse({ ids: Array.from({ length: NOTIFICATION_MARK_READ_MAX_IDS }, () => ID) }).success).toBe(true);
  });
  it.each([
    ["empty list", { ids: [] }],
    ["too many", { ids: Array.from({ length: NOTIFICATION_MARK_READ_MAX_IDS + 1 }, () => ID) }],
    ["not a uuid", { ids: ["x"] }],
    ["missing", {}],
    ["extra key", { ids: null, all: true }],
  ])("rejects %s", (_n, body) => expect(markReadInputSchema.safeParse(body).success).toBe(false));
});

describe("SQL (migration 20261007000400_notifications.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000400_notifications.sql", import.meta.url), "utf8");
  const list = (s: string): string[] => [...s.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
  it("both CHECK lists and the RPC validation carry exactly the contract types", () => {
    const checks = [...sql.matchAll(/check \(type in \(([^)]*)\)\)/g)].map((m) => list(m[1] as string));
    expect(checks).toHaveLength(2);
    for (const c of checks) expect(c).toEqual([...NOTIFICATION_TYPES]);
    const rpc = sql.slice(sql.indexOf("p_type not in ("));
    expect(list(rpc.slice(0, rpc.indexOf(") then"))).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
  it("same limits", () => {
    expect(sql).toContain(`octet_length(metadata::text) <= ${NOTIFICATION_METADATA_MAX_BYTES}`);
    expect(sql).toContain(`cardinality(p_ids) > ${NOTIFICATION_MARK_READ_MAX_IDS}`);
    expect(sql).toContain(`interval '${NOTIFICATION_RETENTION_DAYS} days'`);
  });
  it("parents can read but never write the tables; the RPCs are authenticated-only and the purge service_role-only", () => {
    expect(sql).toMatch(/grant select on public\.notifications\s+to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.parent_mark_notifications_read\(uuid\[\]\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.parent_mark_notifications_read\(uuid\[\]\) to authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.parent_set_notification_preference\(text, boolean\) to authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.notifications_purge_expired\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.notifications_purge_expired\(\) to service_role;/);
  });
  it("every function is SECURITY DEFINER with an empty search_path", () => {
    expect(sql.match(/security definer\s+set search_path = ''/g)).toHaveLength(3);
  });
});

describe("SQL (migration 20261007000500_notification_producers.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000500_notification_producers.sql", import.meta.url), "utf8");
  it("always-on types are exactly the ones the SQL never lets a preference switch off", () => {
    expect([...NOTIFICATION_ALWAYS_ON]).toEqual(["EMERGENCY", "SECURITY_EVENT"]);
    expect(isAlwaysOn("EMERGENCY")).toBe(true);
    expect(isAlwaysOn("BATTERY_LOW")).toBe(false);
    expect(sql).toContain("p_type not in ('EMERGENCY', 'SECURITY_EVENT')");
    expect(sql).toContain("p_type in ('EMERGENCY', 'SECURITY_EVENT') and not p_enabled");
  });
  it("dedupe windows match the contract (minutes)", () => {
    const fmt = (m: number): string => (m % 60 === 0 ? `interval '${m / 60} ${m === 60 ? "hour" : "hours"}'` : `interval '${m} minutes'`);
    for (const [type, minutes] of Object.entries(NOTIFICATION_DEDUPE_MINUTES)) {
      if (minutes === 0) {
        expect(sql).not.toMatch(new RegExp(`when '${type}'\\s+then interval`));
      } else {
        expect(sql).toMatch(new RegExp(`when '${type}'\\s+then ${fmt(minutes)}`));
      }
    }
    expect(sql).toContain("else interval '0 seconds'");
  });
  it("keeps at most the contract number per parent", () => {
    expect(sql).toContain(`offset ${NOTIFICATIONS_PER_PARENT_MAX}`);
  });
  it("nothing can execute the internal functions and every function is SECURITY DEFINER with an empty search_path", () => {
    for (const fn of ["notify_parent(uuid, text, jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
    }
    for (const fn of ["device_events_notify()", "audit_logs_notify()"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
    }
    expect(sql.match(/security definer\s+set search_path = ''/g)).toHaveLength(4);
  });
  it("producers write no package name, label, coordinate or free text", () => {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const meta = code.match(/jsonb_build_object\([^)]*\)/g) ?? [];
    expect(meta.sort()).toEqual(["jsonb_build_object('permission', v_perm)", "jsonb_build_object('reason', 'credential_reuse')"].sort());
    expect(code).not.toMatch(/package_name|app_name|latitude|longitude|label/);
  });
});
