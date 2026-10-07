import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_EVENT_FUTURE_SECONDS } from "./device-app-events";
import {
  deviceLimitReachedRequestSchema, isLimitEventDayInRange, LIMIT_EVENT_DAY_TOLERANCE_DAYS, LIMIT_EVENT_PAST_SECONDS, LIMIT_EVENT_TYPE, parseLimitEventDay,
} from "./device-limit-events";

const OK = { day: "2026-10-01", occurred_at: "2026-10-01T11:58:00.000Z" };

describe("deviceLimitReachedRequestSchema", () => {
  it("accepts a day and a UTC time", () => {
    expect(deviceLimitReachedRequestSchema.safeParse(OK).success).toBe(true);
    expect(deviceLimitReachedRequestSchema.safeParse({ day: "2028-02-29", occurred_at: "2028-02-29T00:00:00Z" }).success).toBe(true);
  });
  it.each([
    ["impossible day", { ...OK, day: "2026-02-30" }],
    ["short day", { ...OK, day: "2026-1-1" }],
    ["day with time", { ...OK, day: "2026-10-01T00:00:00Z" }],
    ["offset time", { ...OK, occurred_at: "2026-10-01T11:58:00+00:00" }],
    ["missing time", { day: OK.day }],
    ["missing day", { occurred_at: OK.occurred_at }],
    ["usage minutes", { ...OK, minutes: 60 }],
    ["package", { ...OK, package_name: "com.example.game" }],
    ["device id", { ...OK, device_id: "x" }],
    ["null", null],
  ])("rejects %s", (_n, body) => expect(deviceLimitReachedRequestSchema.safeParse(body).success).toBe(false));
});

describe("day helpers", () => {
  it("parse real calendar days only", () => {
    expect(parseLimitEventDay("2026-10-01")).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(parseLimitEventDay("2026-02-29")).toBeNull();
    expect(parseLimitEventDay("nope")).toBeNull();
  });
  it("accept one day either side of the server's UTC day", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(LIMIT_EVENT_DAY_TOLERANCE_DAYS).toBe(1);
    for (const d of ["2026-09-30", "2026-10-01", "2026-10-02"]) expect(isLimitEventDayInRange(d, now)).toBe(true);
    for (const d of ["2026-09-29", "2026-10-03", "nope"]) expect(isLimitEventDayInRange(d, now)).toBe(false);
  });
});

describe("Edge mirror and SQL (20261007000600_limit_reached_event.sql) agree with the contract", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-limit-events.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000600_limit_reached_event.sql", import.meta.url), "utf8");
  const handler = readFileSync(new URL("../../../supabase/functions/device-limit-events/handler.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../../../supabase/functions/device-limit-events/index.ts", import.meta.url), "utf8");
  it("the mirror has the same constants, the same two keys and is strict", () => {
    expect(edge).toContain(`export const LIMIT_EVENT_TYPE = "${LIMIT_EVENT_TYPE}";`);
    expect(edge).toContain(`LIMIT_EVENT_DAY_TOLERANCE_DAYS = ${LIMIT_EVENT_DAY_TOLERANCE_DAYS};`);
    expect(edge.match(/^\s+(\w+): z\./gm)?.map((m) => m.trim().split(":")[0])).toEqual(["day", "occurred_at"]);
    expect(edge).toContain(".strict()");
  });
  it("SQL uses the same windows (24 h back, 5 minutes ahead, one day either side) and event type", () => {
    expect(LIMIT_EVENT_PAST_SECONDS).toBe(86_400);
    expect(APP_EVENT_FUTURE_SECONDS).toBe(300);
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("p_day < v_today - 1 or p_day > v_today + 1");
    expect(sql).toContain(`'${LIMIT_EVENT_TYPE}'`);
  });
  it("the function is service_role only, SECURITY DEFINER with an empty search_path and stores only the day and the time", () => {
    expect(sql).toMatch(/revoke all on function public\.device_record_limit_reached\(uuid, date, timestamptz\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.device_record_limit_reached\(uuid, date, timestamptz\) to service_role;/);
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code.match(/jsonb_build_object\([^;]*?\)\);/s)?.[0]).toContain("'day', v_day");
    expect(code).not.toMatch(/package_name|minutes\b.*jsonb_build_object|last_seen_at\s*=|device_status\s*=/);
  });
  it("the Edge calls the RPC with the parameter names the SQL declares and answers with the server time only", () => {
    expect(index).toContain('"device_record_limit_reached"');
    for (const p of ["p_device_id", "p_day", "p_occurred_at"]) {
      expect(index).toContain(p);
      expect(sql).toContain(p);
    }
    expect(handler).toContain("requireActiveDevice");
    expect(handler).toContain("ok({ server_time:");
  });
});
