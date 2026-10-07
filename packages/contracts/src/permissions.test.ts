import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_KEYS,
  PERMISSION_STATES,
  PERMISSION_SYNC_INTERVAL_SECONDS,
  permissionSyncRequestSchema,
  permissionSyncResponseSchema,
} from "./permissions";

const OK = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "NOT_REQUESTED"]));

describe("permissionSyncRequestSchema", () => {
  it("accepts every state for every key", () => {
    for (const key of PERMISSION_KEYS) {
      for (const state of PERMISSION_STATES) {
        expect(permissionSyncRequestSchema.safeParse({ ...OK, [key]: state }).success).toBe(true);
      }
    }
  });
  it("has exactly the 8 catalog permissions", () => {
    expect(PERMISSION_KEYS).toHaveLength(8);
    expect(Object.keys(permissionSyncRequestSchema.shape)).toEqual([...PERMISSION_KEYS]);
  });
  it.each([
    ["extra key (device id)", { ...OK, device_id: "x" }],
    ["extra key (notifications)", { ...OK, notifications: "GRANTED" }],
    ["missing key", (({ sms: _s, ...rest }) => rest)(OK)],
    ["unknown state", { ...OK, camera: "MAYBE" }],
    ["lower-case state", { ...OK, camera: "granted" }],
    ["boolean state", { ...OK, camera: true }],
    ["null state", { ...OK, camera: null }],
    ["empty object", {}],
    ["array", []],
    ["null", null],
  ])("rejects %s", (_n, body) => {
    expect(permissionSyncRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("response", () => {
  it("has the heartbeat shape", () => {
    expect(permissionSyncResponseSchema.safeParse({ server_time: "2026-09-30T12:00:00.000Z", next_interval_seconds: PERMISSION_SYNC_INTERVAL_SECONDS }).success).toBe(true);
    expect(PERMISSION_SYNC_INTERVAL_SECONDS).toBe(21600);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/permissions.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/permissions.ts", import.meta.url), "utf8");
  it("constants and lists match", () => {
    expect(edge).toContain(`export const PERMISSION_SYNC_INTERVAL_SECONDS = ${PERMISSION_SYNC_INTERVAL_SECONDS};`);
    for (const k of PERMISSION_KEYS) expect(edge).toContain(`"${k}",`);
    for (const s of PERMISSION_STATES) expect(edge).toContain(`"${s}",`);
    expect(edge.match(/^\s+"[a-z_]+",$/gm)?.length).toBe(PERMISSION_KEYS.length);
    expect(edge.match(/^\s+"[A-Z_]+",$/gm)?.length).toBe(PERMISSION_STATES.length);
  });
  it("schema keys and strictness match", () => {
    for (const key of PERMISSION_KEYS) expect(edge).toMatch(new RegExp(`^\\s+${key}: stateSchema,$`, "m"));
    expect(edge.match(/^\s+\w+: stateSchema,$/gm)?.length).toBe(PERMISSION_KEYS.length);
    expect(edge).toContain(".strict()");
  });
});

describe("SQL (migration 20260930001300_permission_sync.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260930001300_permission_sync.sql", import.meta.url), "utf8");
  const tables = readFileSync(new URL("../../../supabase/migrations/20260929000300_devices.sql", import.meta.url), "utf8");
  it("lists the same keys and states", () => {
    for (const k of PERMISSION_KEYS) expect(sql).toContain(`'${k}'`);
    for (const s of PERMISSION_STATES) expect(sql).toContain(`'${s}'`);
  });
  it("every key has a *_status column with the same CHECK list", () => {
    const list = PERMISSION_STATES.map((s) => `'${s}'`).join(",");
    for (const k of PERMISSION_KEYS) {
      expect(tables).toMatch(new RegExp(`${k}_status\\s+text not null default 'NOT_REQUESTED' check \\(${k}_status in \\(${list}\\)\\)`));
    }
  });
  it("the RPC is service_role only and never touches liveness columns", () => {
    expect(sql).toMatch(/grant execute on function public\.device_update_permissions\(uuid, jsonb\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_update_permissions\(uuid, jsonb\) from public, anon, authenticated;/);
    const fn = sql.slice(sql.indexOf("create or replace function public.device_update_permissions"));
    expect(fn).not.toMatch(/last_seen_at\s*=|device_status\s*=/);
  });
});
