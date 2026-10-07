import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEVICE_APPS_INTERVAL_SECONDS,
  DEVICE_APPS_LABEL_MAX,
  DEVICE_APPS_MAX,
  DEVICE_APPS_MAX_BODY_BYTES,
  DEVICE_APPS_PACKAGE_MAX,
  DEVICE_APPS_VERSION_MAX,
  PACKAGE_NAME_PATTERN,
  deviceAppSchema,
  deviceAppsRequestSchema,
  deviceAppsResponseSchema,
} from "./device-apps";

const APP = { package_name: "com.example.notes", label: "Notes", version_name: "1.2.3", is_system: false };
const app = (i: number) => ({ ...APP, package_name: `com.example.app${i}` });

describe("deviceAppsRequestSchema", () => {
  it("accepts an empty list, a normal list and a null version", () => {
    expect(deviceAppsRequestSchema.safeParse({ apps: [] }).success).toBe(true);
    expect(deviceAppsRequestSchema.safeParse({ apps: [APP, { ...app(2), version_name: null, is_system: true }] }).success).toBe(true);
  });
  it("accepts exactly DEVICE_APPS_MAX entries and rejects one more", () => {
    expect(deviceAppsRequestSchema.safeParse({ apps: Array.from({ length: DEVICE_APPS_MAX }, (_, i) => app(i)) }).success).toBe(true);
    expect(deviceAppsRequestSchema.safeParse({ apps: Array.from({ length: DEVICE_APPS_MAX + 1 }, (_, i) => app(i)) }).success).toBe(false);
  });
  it("has the four wire keys per entry and strict objects", () => {
    expect(Object.keys(deviceAppSchema.shape)).toEqual(["package_name", "label", "version_name", "is_system"]);
    expect(deviceAppsRequestSchema.safeParse({ apps: [APP], device_id: "x" }).success).toBe(false);
    expect(deviceAppsRequestSchema.safeParse({ apps: [{ ...APP, icon: "x" }] }).success).toBe(false);
  });
  it("trims label and version", () => {
    const r = deviceAppsRequestSchema.parse({ apps: [{ ...APP, label: "  Notes ", version_name: " 1.0 " }] });
    expect(r.apps[0]).toMatchObject({ label: "Notes", version_name: "1.0" });
  });
  it("limits are inclusive", () => {
    const ok = { package_name: "a." + "b".repeat(DEVICE_APPS_PACKAGE_MAX - 2), label: "L".repeat(DEVICE_APPS_LABEL_MAX), version_name: "v".repeat(DEVICE_APPS_VERSION_MAX), is_system: false };
    expect(deviceAppSchema.safeParse(ok).success).toBe(true);
    expect(deviceAppSchema.safeParse({ ...ok, package_name: ok.package_name + "b" }).success).toBe(false);
    expect(deviceAppSchema.safeParse({ ...ok, label: ok.label + "L" }).success).toBe(false);
    expect(deviceAppSchema.safeParse({ ...ok, version_name: ok.version_name + "v" }).success).toBe(false);
  });
  it.each([
    ["no dot", { ...APP, package_name: "nodots" }],
    ["leading digit", { ...APP, package_name: "1com.example" }],
    ["empty segment", { ...APP, package_name: "com..example" }],
    ["trailing dot", { ...APP, package_name: "com.example." }],
    ["hyphen", { ...APP, package_name: "com.ex-ample.x" }],
    ["space", { ...APP, package_name: "com.exa mple.x" }],
    ["empty label", { ...APP, label: "" }],
    ["blank label", { ...APP, label: "   " }],
    ["null label", { ...APP, label: null }],
    ["control char label", { ...APP, label: "a\u0000b" }],
    ["newline label", { ...APP, label: "a\nb" }],
    ["C1 control label", { ...APP, label: "a\u0085b" }],
    ["empty version", { ...APP, version_name: "" }],
    ["blank version", { ...APP, version_name: " " }],
    ["numeric version", { ...APP, version_name: 1 }],
    ["string is_system", { ...APP, is_system: "true" }],
    ["missing is_system", (({ is_system: _s, ...r }) => r)(APP)],
    ["missing version_name", (({ version_name: _v, ...r }) => r)(APP)],
  ])("rejects entry: %s", (_n, entry) => {
    expect(deviceAppsRequestSchema.safeParse({ apps: [entry] }).success).toBe(false);
  });
  it("rejects duplicate package names", () => {
    expect(deviceAppsRequestSchema.safeParse({ apps: [APP, { ...APP, label: "Other" }] }).success).toBe(false);
  });
  it.each([["null", null], ["array", []], ["empty object", {}], ["apps null", { apps: null }], ["apps object", { apps: {} }], ["extra key", { apps: [], x: 1 }]])(
    "rejects body: %s",
    (_n, body) => expect(deviceAppsRequestSchema.safeParse(body).success).toBe(false),
  );
});

describe("constants and response", () => {
  it("matches the plan", () => {
    expect(DEVICE_APPS_MAX).toBe(500);
    expect(DEVICE_APPS_INTERVAL_SECONDS).toBe(86400);
    expect([DEVICE_APPS_PACKAGE_MAX, DEVICE_APPS_LABEL_MAX, DEVICE_APPS_VERSION_MAX]).toEqual([255, 200, 100]);
  });
  it("the body cap fits 500 maximal entries and is bounded", () => {
    const maxEntry = JSON.stringify({ package_name: "a." + "b".repeat(253), label: "L".repeat(200), version_name: "v".repeat(100), is_system: false });
    expect(maxEntry.length * DEVICE_APPS_MAX).toBeLessThan(DEVICE_APPS_MAX_BODY_BYTES);
    expect(DEVICE_APPS_MAX_BODY_BYTES).toBeLessThanOrEqual(1048576);
  });
  it("response has the heartbeat shape", () => {
    expect(deviceAppsResponseSchema.safeParse({ server_time: "2026-10-01T12:00:00.000Z", next_interval_seconds: DEVICE_APPS_INTERVAL_SECONDS }).success).toBe(true);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-apps.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-apps.ts", import.meta.url), "utf8");
  it("constants match", () => {
    expect(edge).toContain(`export const DEVICE_APPS_INTERVAL_SECONDS = ${DEVICE_APPS_INTERVAL_SECONDS};`);
    expect(edge).toContain(`export const DEVICE_APPS_MAX = ${DEVICE_APPS_MAX};`);
    expect(edge).toContain(`export const DEVICE_APPS_PACKAGE_MAX = ${DEVICE_APPS_PACKAGE_MAX};`);
    expect(edge).toContain(`export const DEVICE_APPS_LABEL_MAX = ${DEVICE_APPS_LABEL_MAX};`);
    expect(edge).toContain(`export const DEVICE_APPS_VERSION_MAX = ${DEVICE_APPS_VERSION_MAX};`);
    expect(edge).toContain(`export const DEVICE_APPS_MAX_BODY_BYTES = ${DEVICE_APPS_MAX_BODY_BYTES};`);
  });
  it("package pattern and control-character class are identical", () => {
    expect(edge).toContain(`export const PACKAGE_NAME_PATTERN = ${PACKAGE_NAME_PATTERN.toString()};`);
    const src = readFileSync(new URL("./device-apps.ts", import.meta.url), "utf8");
    const cls = /const CONTROL_CHARS = (\/.*\/);/.exec(src)?.[1];
    expect(cls).toBeTruthy();
    expect(edge).toContain(`const CONTROL_CHARS = ${cls};`);
  });
  it("entry keys, strictness and duplicate rule match", () => {
    for (const k of ["package_name", "label", "version_name", "is_system"]) expect(edge).toMatch(new RegExp(`^\\s+${k}: `, "m"));
    expect(edge.match(/\.strict\(\)/g)?.length).toBe(2);
    expect(edge).toContain("duplicate package name");
    expect(edge).toContain(".max(DEVICE_APPS_MAX)");
    expect(edge).toContain("trimmedText(DEVICE_APPS_LABEL_MAX)");
    expect(edge).toContain("trimmedText(DEVICE_APPS_VERSION_MAX).nullable()");
  });
});

describe("SQL (migration 20260930001400_device_apps.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260930001400_device_apps.sql", import.meta.url), "utf8");
  it("same cap and field limits", () => {
    expect(sql).toContain(`c_max     constant int := ${DEVICE_APPS_MAX};`);
    expect(sql).toContain(`char_length(package_name) <= ${DEVICE_APPS_PACKAGE_MAX}`);
    expect(sql).toContain(`char_length(label) between 1 and ${DEVICE_APPS_LABEL_MAX}`);
    expect(sql).toContain(`char_length(version_name) between 1 and ${DEVICE_APPS_VERSION_MAX}`);
  });
  it("same package-name pattern (POSIX form of the JS regex)", () => {
    const posix = PACKAGE_NAME_PATTERN.source.replace(/\\\./g, "\\.");
    expect(sql).toContain(`'${posix}'`);
  });
  it("entry keys are the four wire keys", () => {
    for (const k of Object.keys(deviceAppSchema.shape)) expect(sql).toContain(`'${k}'`);
  });
  it("the RPC is service_role only and never touches liveness columns", () => {
    expect(sql).toMatch(/grant execute on function public\.device_sync_apps\(uuid, jsonb\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_sync_apps\(uuid, jsonb\) from public, anon, authenticated;/);
    const fn = sql.slice(sql.indexOf("create or replace function public.device_sync_apps"));
    expect(fn).not.toMatch(/last_seen_at\s*=|device_status\s*=/);
  });
  it("the Edge function calls the RPC with the parameter names the SQL declares", () => {
    const idx = readFileSync(new URL("../../../supabase/functions/device-apps/index.ts", import.meta.url), "utf8");
    expect(idx).toContain('"device_sync_apps"');
    expect(idx).toContain("p_device_id: deviceId");
    expect(idx).toContain("p_apps: apps");
    expect(sql).toContain("p_device_id uuid");
    expect(sql).toContain("p_apps      jsonb");
    expect(idx).toContain('row?.o_outcome === "recorded"');
    expect(sql).toContain("o_outcome text");
  });
});
