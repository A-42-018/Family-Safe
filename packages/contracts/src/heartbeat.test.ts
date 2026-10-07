import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_STALE_SECONDS,
  heartbeatRequestSchema,
  heartbeatResponseSchema,
  NETWORK_TYPES,
} from "./heartbeat";

const OK = { app_version: "0.12.0", android_version: "16", battery_level: 80, is_charging: false, network_type: "WIFI" };

describe("heartbeatRequestSchema", () => {
  it("accepts the documented shape and every network type", () => {
    expect(heartbeatRequestSchema.safeParse(OK).success).toBe(true);
    for (const network_type of NETWORK_TYPES) expect(heartbeatRequestSchema.safeParse({ ...OK, network_type }).success).toBe(true);
  });
  it("accepts battery 0 and 100, rejects out-of-range, fractional and non-numeric", () => {
    for (const b of [0, 100]) expect(heartbeatRequestSchema.safeParse({ ...OK, battery_level: b }).success).toBe(true);
    for (const b of [-1, 101, 50.5, "80", null]) expect(heartbeatRequestSchema.safeParse({ ...OK, battery_level: b }).success).toBe(false);
  });
  it("rejects empty / over-long versions, unknown network types and non-boolean charging", () => {
    expect(heartbeatRequestSchema.safeParse({ ...OK, app_version: "" }).success).toBe(false);
    expect(heartbeatRequestSchema.safeParse({ ...OK, app_version: "x".repeat(33) }).success).toBe(false);
    expect(heartbeatRequestSchema.safeParse({ ...OK, android_version: "" }).success).toBe(false);
    expect(heartbeatRequestSchema.safeParse({ ...OK, network_type: "5G" }).success).toBe(false);
    expect(heartbeatRequestSchema.safeParse({ ...OK, is_charging: "false" }).success).toBe(false);
  });
  it("is strict: no device id, location or permission state can ride along", () => {
    for (const extra of [{ device_id: "d" }, { latitude: 1 }, { permissions: {} }, { last_sync: "x" }]) {
      expect(heartbeatRequestSchema.safeParse({ ...OK, ...extra }).success).toBe(false);
    }
  });
});

describe("heartbeatResponseSchema", () => {
  it("accepts the documented shape", () => {
    expect(heartbeatResponseSchema.safeParse({ server_time: "2026-10-01T00:00:00.000Z", next_interval_seconds: 900 }).success).toBe(true);
    expect(heartbeatResponseSchema.safeParse({ server_time: "x", next_interval_seconds: 0 }).success).toBe(false);
  });
});

describe("constants", () => {
  it("stale threshold is three missed beats", () => expect(HEARTBEAT_STALE_SECONDS).toBe(3 * HEARTBEAT_INTERVAL_SECONDS));
  it("network types equal the devices.network_type CHECK list", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20260929000300_devices.sql", import.meta.url), "utf8");
    for (const t of NETWORK_TYPES) expect(sql).toContain(`'${t}'`);
    expect(/network_type in \(([^)]*)\)/.exec(sql)?.[1]?.split(",").length).toBe(NETWORK_TYPES.length);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/heartbeat.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/heartbeat.ts", import.meta.url), "utf8");
  it("constants and network types match", () => {
    expect(edge).toContain(`export const HEARTBEAT_INTERVAL_SECONDS = ${HEARTBEAT_INTERVAL_SECONDS};`);
    expect(edge).toContain(`export const HEARTBEAT_STALE_SECONDS = ${HEARTBEAT_STALE_SECONDS};`);
    expect(edge).toContain(`NETWORK_TYPES = [${NETWORK_TYPES.map((t) => `"${t}"`).join(", ")}] as const`);
  });
  it("request fields, limits and strictness match", () => {
    for (const line of [
      "app_version: z.string().min(1).max(32)",
      "android_version: z.string().min(1).max(32)",
      "battery_level: z.number().int().min(0).max(100)",
      "is_charging: z.boolean()",
      "network_type: z.enum(NETWORK_TYPES)",
      "}).strict();",
    ]) expect(edge).toContain(line);
  });
  it("the SQL function accepts the same network types and battery range", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20260929001100_heartbeat.sql", import.meta.url), "utf8");
    for (const t of NETWORK_TYPES) expect(sql).toContain(`'${t}'`);
    expect(sql).toContain("p_battery_level not between 0 and 100");
    expect(sql).toContain("not between 1 and 32");
  });
});
