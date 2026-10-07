import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEVICE_INFO_INTERVAL_SECONDS,
  SDK_LEVEL_MAX,
  SDK_LEVEL_MIN,
  SECURITY_PATCH_MIN,
  STORAGE_MB_MAX,
  deviceInfoRequestSchema,
  deviceInfoResponseSchema,
  isSecurityPatchDate,
} from "./device-info";

const OK = { sdk_level: 36, security_patch: "2026-09-05", storage_total_mb: 128000, storage_free_mb: 64000, managed_mode: false };

describe("deviceInfoRequestSchema", () => {
  it("accepts a full upload and an all-unknown one", () => {
    expect(deviceInfoRequestSchema.safeParse(OK).success).toBe(true);
    expect(deviceInfoRequestSchema.safeParse({ sdk_level: 31, security_patch: null, storage_total_mb: null, storage_free_mb: null, managed_mode: false }).success).toBe(true);
  });
  it("accepts the boundaries", () => {
    expect(deviceInfoRequestSchema.safeParse({ sdk_level: SDK_LEVEL_MIN, security_patch: SECURITY_PATCH_MIN, storage_total_mb: 1, storage_free_mb: 1, managed_mode: true }).success).toBe(true);
    expect(deviceInfoRequestSchema.safeParse({ sdk_level: SDK_LEVEL_MAX, security_patch: null, storage_total_mb: STORAGE_MB_MAX, storage_free_mb: 0, managed_mode: false }).success).toBe(true);
  });
  it.each([
    ["extra key (device id)", { ...OK, device_id: "x" }],
    ["extra key (serial)", { ...OK, serial: "x" }],
    ["missing key", { sdk_level: 34, security_patch: null, storage_total_mb: null }],
    ["sdk 0", { ...OK, sdk_level: 0 }],
    ["sdk 100", { ...OK, sdk_level: 100 }],
    ["sdk fractional", { ...OK, sdk_level: 34.5 }],
    ["sdk string", { ...OK, sdk_level: "34" }],
    ["patch not a date", { ...OK, security_patch: "2026-02-30" }],
    ["patch with time", { ...OK, security_patch: "2026-09-05T00:00:00Z" }],
    ["patch before 2010", { ...OK, security_patch: "2009-12-31" }],
    ["total 0", { ...OK, storage_total_mb: 0 }],
    ["total above ceiling", { ...OK, storage_total_mb: STORAGE_MB_MAX + 1 }],
    ["free negative", { ...OK, storage_free_mb: -1 }],
    ["free above total", { ...OK, storage_free_mb: 128001 }],
    ["total without free", { ...OK, storage_free_mb: null }],
    ["free without total", { ...OK, storage_total_mb: null }],
    ["managed_mode missing", { sdk_level: 36, security_patch: "2026-09-05", storage_total_mb: 128000, storage_free_mb: 64000 }],
    ["managed_mode null", { ...OK, managed_mode: null }],
    ["managed_mode string", { ...OK, managed_mode: "true" }],
    ["managed_mode number", { ...OK, managed_mode: 1 }],
  ])("rejects %s", (_n, body) => {
    expect(deviceInfoRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("isSecurityPatchDate", () => {
  it("accepts real dates only", () => {
    expect(isSecurityPatchDate("2024-02-29")).toBe(true);
    expect(isSecurityPatchDate("2023-02-29")).toBe(false);
    expect(isSecurityPatchDate("2026-04-31")).toBe(false);
    expect(isSecurityPatchDate("2026-9-5")).toBe(false);
    expect(isSecurityPatchDate("")).toBe(false);
  });
});

describe("response", () => {
  it("has the heartbeat shape", () => {
    expect(deviceInfoResponseSchema.safeParse({ server_time: "2026-09-30T12:00:00.000Z", next_interval_seconds: DEVICE_INFO_INTERVAL_SECONDS }).success).toBe(true);
    expect(DEVICE_INFO_INTERVAL_SECONDS).toBe(86400);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-info.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-info.ts", import.meta.url), "utf8");
  it("constants match", () => {
    expect(edge).toContain(`export const DEVICE_INFO_INTERVAL_SECONDS = ${DEVICE_INFO_INTERVAL_SECONDS};`);
    expect(edge).toContain(`export const SDK_LEVEL_MIN = ${SDK_LEVEL_MIN};`);
    expect(edge).toContain(`export const SDK_LEVEL_MAX = ${SDK_LEVEL_MAX};`);
    expect(edge).toContain(`export const STORAGE_MB_MAX = ${STORAGE_MB_MAX};`);
    expect(edge).toContain(`export const SECURITY_PATCH_MIN = "${SECURITY_PATCH_MIN}";`);
  });
  it("field list and strictness match", () => {
    for (const key of Object.keys(deviceInfoRequestSchema.innerType().shape)) expect(edge).toMatch(new RegExp(`\\b${key}:`));
    expect(edge).toContain(".strict()");
    expect(edge.match(/^\s+(\w+): z\./gm)?.length).toBe(5);
  });
  it("field rules match", () => {
    expect(edge).toContain("z.number().int().min(SDK_LEVEL_MIN).max(SDK_LEVEL_MAX)");
    expect(edge).toContain("z.number().int().min(1).max(STORAGE_MB_MAX).nullable()");
    expect(edge).toContain("z.number().int().min(0).max(STORAGE_MB_MAX).nullable()");
    expect(edge).toContain(".refine(isSecurityPatchDate");
    expect(edge).toContain("free storage exceeds total");
  });
});

describe("SQL (migration 20260929001200_device_info.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260929001200_device_info.sql", import.meta.url), "utf8");
  it("uses the same limits", () => {
    expect(sql).toContain(`sdk_level between ${SDK_LEVEL_MIN} and ${SDK_LEVEL_MAX}`);
    expect(sql).toContain(`storage_total_mb between 1 and ${STORAGE_MB_MAX}`);
    expect(sql).toContain(`storage_free_mb  int  check (storage_free_mb between 0 and ${STORAGE_MB_MAX})`);
    expect(sql).toContain(`date '${SECURITY_PATCH_MIN}'`);
  });
  it("the RPC is service_role only and never touches liveness columns", () => {
    expect(sql).toMatch(/grant execute on function public\.device_update_info\(uuid, int, date, int, int\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_update_info\(uuid, int, date, int, int\) from public, anon, authenticated;/);
    const fn = sql.slice(sql.indexOf("create or replace function public.device_update_info"));
    expect(fn).not.toMatch(/last_seen_at\s*=|device_status\s*=/);
  });
});

describe("SQL (migration 20261007000100_managed_mode.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000100_managed_mode.sql", import.meta.url), "utf8");
  it("adds a nullable boolean the parent cannot write", () => {
    expect(sql).toMatch(/add column managed_mode boolean;/);
    expect(sql).not.toMatch(/managed_mode boolean not null/i);
    expect(sql).not.toMatch(/grant update[^;]*managed_mode/i);
  });
  it("the 6-argument RPC is service_role only, requires the flag and never touches liveness columns", () => {
    expect(sql).toMatch(/revoke all on function public\.device_update_info\(uuid, int, date, int, int, boolean\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.device_update_info\(uuid, int, date, int, int, boolean\) to service_role;/);
    expect(sql).toMatch(/if p_managed_mode is null then/);
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    expect(sql).not.toMatch(/last_seen_at\s*=|device_status\s*=/);
  });
});
