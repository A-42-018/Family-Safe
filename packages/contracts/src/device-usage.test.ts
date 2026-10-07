import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEVICE_USAGE_FUTURE_DAYS,
  DEVICE_USAGE_INTERVAL_SECONDS,
  DEVICE_USAGE_MAX_APPS,
  DEVICE_USAGE_MAX_COUNT,
  DEVICE_USAGE_MAX_MINUTES,
  DEVICE_USAGE_PAST_DAYS,
  appUsageSchema,
  deviceUsageRequestSchema,
  deviceUsageResponseSchema,
  isUsageDate,
  isUsageDayInRange,
} from "./device-usage";
import { PACKAGE_NAME_PATTERN } from "./device-apps";

const APP = { package_name: "com.example.notes", foreground_minutes: 30, launch_count: 4 };
const USAGE = { day: "2026-10-01", total_screen_minutes: 120, unlock_count: 15, apps: [APP] };
const app = (i: number) => ({ ...APP, package_name: `com.example.app${i}`, foreground_minutes: 1 });
const NOW = Date.parse("2026-10-01T12:00:00Z");

describe("deviceUsageRequestSchema", () => {
  it("accepts a normal report, an empty app list and zeros", () => {
    expect(deviceUsageRequestSchema.safeParse(USAGE).success).toBe(true);
    expect(deviceUsageRequestSchema.safeParse({ ...USAGE, apps: [] }).success).toBe(true);
    expect(deviceUsageRequestSchema.safeParse({ day: "2026-10-01", total_screen_minutes: 0, unlock_count: 0, apps: [] }).success).toBe(true);
  });
  it("has exactly the four wire keys and strict objects", () => {
    expect(Object.keys(deviceUsageRequestSchema.shape)).toEqual(["day", "total_screen_minutes", "unlock_count", "apps"]);
    expect(Object.keys(appUsageSchema.shape)).toEqual(["package_name", "foreground_minutes", "launch_count"]);
    expect(deviceUsageRequestSchema.safeParse({ ...USAGE, device_id: "x" }).success).toBe(false);
    expect(deviceUsageRequestSchema.safeParse({ ...USAGE, apps: [{ ...APP, label: "Notes" }] }).success).toBe(false);
  });
  it("accepts exactly DEVICE_USAGE_MAX_APPS entries and rejects one more", () => {
    expect(deviceUsageRequestSchema.safeParse({ ...USAGE, apps: Array.from({ length: DEVICE_USAGE_MAX_APPS }, (_, i) => app(i)) }).success).toBe(true);
    expect(deviceUsageRequestSchema.safeParse({ ...USAGE, apps: Array.from({ length: DEVICE_USAGE_MAX_APPS + 1 }, (_, i) => app(i)) }).success).toBe(false);
  });
  it("limits are inclusive", () => {
    const top = { day: "2026-10-01", total_screen_minutes: DEVICE_USAGE_MAX_MINUTES, unlock_count: DEVICE_USAGE_MAX_COUNT, apps: [{ package_name: "a.b", foreground_minutes: DEVICE_USAGE_MAX_MINUTES, launch_count: DEVICE_USAGE_MAX_COUNT }] };
    expect(deviceUsageRequestSchema.safeParse(top).success).toBe(true);
    expect(deviceUsageRequestSchema.safeParse({ ...top, total_screen_minutes: DEVICE_USAGE_MAX_MINUTES + 1 }).success).toBe(false);
    expect(deviceUsageRequestSchema.safeParse({ ...top, unlock_count: DEVICE_USAGE_MAX_COUNT + 1 }).success).toBe(false);
    expect(deviceUsageRequestSchema.safeParse({ ...top, apps: [{ ...top.apps[0], foreground_minutes: DEVICE_USAGE_MAX_MINUTES + 1 }] }).success).toBe(false);
    expect(deviceUsageRequestSchema.safeParse({ ...top, apps: [{ ...top.apps[0], launch_count: DEVICE_USAGE_MAX_COUNT + 1 }] }).success).toBe(false);
  });
  it("app minutes may sum to one day but not more", () => {
    const two = (a: number, b: number) => ({ ...USAGE, apps: [{ ...APP, foreground_minutes: a }, { ...APP, package_name: "com.other.app", foreground_minutes: b }] });
    expect(deviceUsageRequestSchema.safeParse(two(1000, 440)).success).toBe(true);
    expect(deviceUsageRequestSchema.safeParse(two(1000, 441)).success).toBe(false);
  });
  it.each([
    ["negative total", { ...USAGE, total_screen_minutes: -1 }],
    ["fractional total", { ...USAGE, total_screen_minutes: 1.5 }],
    ["string total", { ...USAGE, total_screen_minutes: "5" }],
    ["null unlocks", { ...USAGE, unlock_count: null }],
    ["negative unlocks", { ...USAGE, unlock_count: -1 }],
    ["missing day", (({ day: _d, ...r }) => r)(USAGE)],
    ["missing unlocks", (({ unlock_count: _u, ...r }) => r)(USAGE)],
    ["day without zero padding", { ...USAGE, day: "2026-10-1" }],
    ["impossible day", { ...USAGE, day: "2026-02-30" }],
    ["timestamp instead of day", { ...USAGE, day: "2026-10-01T00:00:00Z" }],
    ["numeric day", { ...USAGE, day: 20261001 }],
    ["duplicate package", { ...USAGE, apps: [APP, { ...APP }] }],
    ["package without a dot", { ...USAGE, apps: [{ ...APP, package_name: "nodots" }] }],
    ["package starting with a digit", { ...USAGE, apps: [{ ...APP, package_name: "1com.example" }] }],
    ["package with a hyphen", { ...USAGE, apps: [{ ...APP, package_name: "com.ex-ample.x" }] }],
    ["256-char package", { ...USAGE, apps: [{ ...APP, package_name: "a." + "b".repeat(254) }] }],
    ["negative app minutes", { ...USAGE, apps: [{ ...APP, foreground_minutes: -1 }] }],
    ["missing launch_count", { ...USAGE, apps: [(({ launch_count: _l, ...r }) => r)(APP)] }],
  ])("rejects: %s", (_n, body) => {
    expect(deviceUsageRequestSchema.safeParse(body).success).toBe(false);
  });
  it.each([["null", null], ["array", []], ["empty object", {}], ["apps null", { ...USAGE, apps: null }], ["apps object", { ...USAGE, apps: {} }]])(
    "rejects body: %s",
    (_n, body) => expect(deviceUsageRequestSchema.safeParse(body).success).toBe(false),
  );
});

describe("day helpers", () => {
  it("isUsageDate accepts only real calendar dates", () => {
    expect(isUsageDate("2026-10-01")).toBe(true);
    expect(isUsageDate("2028-02-29")).toBe(true);
    expect(isUsageDate("2026-02-29")).toBe(false);
    expect(isUsageDate("2026-13-01")).toBe(false);
    expect(isUsageDate("2026-10-1")).toBe(false);
    expect(isUsageDate("")).toBe(false);
  });
  it("isUsageDayInRange is today-14 .. today+1 (UTC), inclusive", () => {
    expect(DEVICE_USAGE_PAST_DAYS).toBe(14);
    expect(DEVICE_USAGE_FUTURE_DAYS).toBe(1);
    expect(isUsageDayInRange("2026-10-01", NOW)).toBe(true);
    expect(isUsageDayInRange("2026-09-17", NOW)).toBe(true);
    expect(isUsageDayInRange("2026-09-16", NOW)).toBe(false);
    expect(isUsageDayInRange("2026-10-02", NOW)).toBe(true);
    expect(isUsageDayInRange("2026-10-03", NOW)).toBe(false);
    expect(isUsageDayInRange("2026-02-30", NOW)).toBe(false);
  });
  it("the window moves with the clock (month boundary)", () => {
    const n = Date.parse("2026-11-03T00:00:01Z");
    expect(isUsageDayInRange("2026-10-20", n)).toBe(true);
    expect(isUsageDayInRange("2026-10-19", n)).toBe(false);
    expect(isUsageDayInRange("2026-11-04", n)).toBe(true);
  });
});

describe("constants and response", () => {
  it("matches the plan", () => {
    expect(DEVICE_USAGE_MAX_APPS).toBe(200);
    expect(DEVICE_USAGE_MAX_MINUTES).toBe(1440);
    expect(DEVICE_USAGE_MAX_COUNT).toBe(10000);
    expect(DEVICE_USAGE_INTERVAL_SECONDS).toBe(21600);
  });
  it("a maximal report fits the generic 64 KB body cap", () => {
    const maxApp = JSON.stringify({ package_name: "a." + "b".repeat(253), foreground_minutes: 1440, launch_count: 10000 });
    expect(maxApp.length * DEVICE_USAGE_MAX_APPS + 200).toBeLessThan(64 * 1024);
  });
  it("response has the heartbeat shape", () => {
    expect(deviceUsageResponseSchema.safeParse({ server_time: "2026-10-01T12:00:00.000Z", next_interval_seconds: DEVICE_USAGE_INTERVAL_SECONDS }).success).toBe(true);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-usage.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-usage.ts", import.meta.url), "utf8");
  it("constants match", () => {
    expect(edge).toContain(`export const DEVICE_USAGE_INTERVAL_SECONDS = ${DEVICE_USAGE_INTERVAL_SECONDS};`);
    expect(edge).toContain(`export const DEVICE_USAGE_MAX_APPS = ${DEVICE_USAGE_MAX_APPS};`);
    expect(edge).toContain(`export const DEVICE_USAGE_MAX_MINUTES = ${DEVICE_USAGE_MAX_MINUTES};`);
    expect(edge).toContain(`export const DEVICE_USAGE_MAX_COUNT = ${DEVICE_USAGE_MAX_COUNT};`);
    expect(edge).toContain(`export const DEVICE_USAGE_PAST_DAYS = ${DEVICE_USAGE_PAST_DAYS};`);
    expect(edge).toContain(`export const DEVICE_USAGE_FUTURE_DAYS = ${DEVICE_USAGE_FUTURE_DAYS};`);
  });
  it("package pattern is identical", () => {
    expect(edge).toContain(`export const PACKAGE_NAME_PATTERN = ${PACKAGE_NAME_PATTERN.toString()};`);
  });
  it("keys, strictness, sum and duplicate rules match", () => {
    for (const k of ["day", "total_screen_minutes", "unlock_count", "apps", "package_name", "foreground_minutes", "launch_count"]) {
      expect(edge).toMatch(new RegExp(`^\\s+${k}: `, "m"));
    }
    expect(edge.match(/\.strict\(\)/g)?.length).toBe(2);
    expect(edge).toContain("duplicate package name");
    expect(edge).toContain("app minutes exceed one day");
    expect(edge).toContain(".max(DEVICE_USAGE_MAX_APPS)");
    expect(edge).toContain("z.number().int().min(0).max(DEVICE_USAGE_MAX_MINUTES)");
    expect(edge).toContain("z.number().int().min(0).max(DEVICE_USAGE_MAX_COUNT)");
  });
  it("day helpers have identical bodies", () => {
    const src = readFileSync(new URL("./device-usage.ts", import.meta.url), "utf8");
    const body = (s: string, name: string) => new RegExp(`export function ${name}\\([^)]*\\): boolean \\{[\\s\\S]*?\\n\\}`).exec(s)?.[0];
    for (const fn of ["isUsageDate", "isUsageDayInRange"]) {
      expect(body(src, fn)).toBeTruthy();
      expect(body(edge, fn)).toBe(body(src, fn));
    }
  });
});

describe("SQL (migration 20260930001500_device_usage.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260930001500_device_usage.sql", import.meta.url), "utf8");
  it("same caps and windows", () => {
    expect(sql).toContain(`c_max_apps   constant int := ${DEVICE_USAGE_MAX_APPS};`);
    expect(sql).toContain(`c_past_days  constant int := ${DEVICE_USAGE_PAST_DAYS};`);
    expect(sql).toContain(`c_minutes    constant int := ${DEVICE_USAGE_MAX_MINUTES};`);
    expect(sql).toContain(`c_count_max  constant int := ${DEVICE_USAGE_MAX_COUNT};`);
    expect(sql).toContain(`p_day > current_date + ${DEVICE_USAGE_FUTURE_DAYS}`);
  });
  it("same package-name pattern (POSIX form of the JS regex)", () => {
    expect(sql).toContain(`'${PACKAGE_NAME_PATTERN.source}'`);
  });
  it("wire keys are the ones the SQL requires", () => {
    for (const k of [...Object.keys(deviceUsageRequestSchema.shape).filter((x) => x !== "day"), ...Object.keys(appUsageSchema.shape)]) {
      expect(sql).toContain(`'${k}'`);
    }
  });
  it("tables already enforce the same per-row bounds", () => {
    const base = readFileSync(new URL("../../../supabase/migrations/20260929000400_rules_usage_schedules.sql", import.meta.url), "utf8");
    expect(base).toContain(`foreground_minutes int not null default 0 check (foreground_minutes between 0 and ${DEVICE_USAGE_MAX_MINUTES})`);
    expect(base).toContain(`total_screen_minutes int not null default 0 check (total_screen_minutes between 0 and ${DEVICE_USAGE_MAX_MINUTES})`);
  });
  it("the RPC is service_role only, merges with GREATEST, never deletes and never touches liveness columns", () => {
    expect(sql).toMatch(/grant execute on function public\.device_upload_usage\(uuid, date, jsonb\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_upload_usage\(uuid, date, jsonb\) from public, anon, authenticated;/);
    const fn = sql.slice(sql.indexOf("create or replace function public.device_upload_usage"));
    expect(fn).not.toMatch(/last_seen_at\s*=|device_status\s*=/);
    expect(fn).not.toMatch(/\bdelete\s+from\b/i);
    expect(fn.match(/greatest\(/g)?.length).toBe(4);
  });
  it("the Edge function calls the RPC with the parameter names the SQL declares", () => {
    const idx = readFileSync(new URL("../../../supabase/functions/device-usage/index.ts", import.meta.url), "utf8");
    expect(idx).toContain('"device_upload_usage"');
    for (const p of ["p_device_id: deviceId", "p_day: usage.day", "p_usage: {"]) expect(idx).toContain(p);
    for (const p of ["p_device_id uuid", "p_day       date", "p_usage     jsonb"]) expect(sql).toContain(p);
    expect(idx).toContain("total_screen_minutes: usage.total_screen_minutes");
    expect(idx).toContain("unlock_count: usage.unlock_count");
    expect(idx).toContain("apps: usage.apps");
    expect(idx).toContain('row?.o_outcome === "recorded"');
    expect(sql).toContain("o_outcome text");
  });
});
