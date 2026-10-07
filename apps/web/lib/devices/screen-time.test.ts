import { DEVICE_USAGE_FUTURE_DAYS, DEVICE_USAGE_INTERVAL_SECONDS } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import {
  asTodayRow,
  summarizeToday,
  TODAY_ROWS_PER_DEVICE,
  TODAY_USAGE_COLUMNS,
  todayHint,
  todayQueryRange,
  todayValue,
  type TodayDevice,
  type TodayInput,
  type TodaySummary,
} from "./screen-time";

const NOW = new Date("2026-10-01T12:00:00Z");
const FRESH = "2026-10-01T10:00:00Z";
const dev = (id: string, enrollmentStatus: TodayDevice["enrollmentStatus"] = "ENROLLED"): TodayDevice => ({ id, enrollmentStatus });
const row = (deviceId: string, day: string, screenMinutes: number) => ({ deviceId, day, screenMinutes, unlocks: 3 });
const input = (devices: TodayDevice[], rows: TodayInput["rows"], synced: Record<string, string | null>): TodayInput => ({
  devices,
  rows,
  syncedAt: new Map(Object.entries(synced)),
});

describe("constants and range", () => {
  it("reads the same columns as the usage page plus the device id", () => {
    expect(TODAY_USAGE_COLUMNS).toBe("device_id,usage_date,total_screen_minutes,unlock_count");
  });
  it("queries yesterday … the contract's one-day-ahead slack", () => {
    expect(todayQueryRange(NOW)).toEqual({ from: "2026-09-30", to: "2026-10-02" });
    expect(TODAY_ROWS_PER_DEVICE).toBe(2 + DEVICE_USAGE_FUTURE_DAYS);
  });
});

describe("asTodayRow", () => {
  it("accepts a usable row", () => {
    expect(asTodayRow({ device_id: "d1", usage_date: "2026-10-01", total_screen_minutes: 90, unlock_count: 4 })).toEqual({ deviceId: "d1", day: "2026-10-01", screenMinutes: 90, unlocks: 4 });
  });
  it("skips anything unusable", () => {
    for (const bad of [null, "x", {}, { device_id: "", usage_date: "2026-10-01", total_screen_minutes: 1, unlock_count: 1 }, { device_id: 5, usage_date: "2026-10-01", total_screen_minutes: 1, unlock_count: 1 }, { device_id: "d", usage_date: "2026-13-40", total_screen_minutes: 1, unlock_count: 1 }, { device_id: "d", usage_date: "2026-10-01", total_screen_minutes: -1, unlock_count: 1 }, { device_id: "d", usage_date: "2026-10-01", total_screen_minutes: 1441, unlock_count: 1 }]) {
      expect(asTodayRow(bad)).toBeNull();
    }
  });
});

describe("summarizeToday", () => {
  it("sums the current day of every reporting device", () => {
    const s = summarizeToday(input([dev("a"), dev("b")], [row("a", "2026-10-01", 60), row("b", "2026-10-01", 65)], { a: FRESH, b: FRESH }), NOW);
    expect(s).toEqual({ active: 2, reporting: 2, waiting: 0, stale: 0, totalMinutes: 125 });
  });
  it("ignores yesterday's row: a day without a report is no data, never 0 minutes", () => {
    const s = summarizeToday(input([dev("a")], [row("a", "2026-09-30", 200)], { a: FRESH }), NOW);
    expect(s).toMatchObject({ active: 1, reporting: 0, totalMinutes: null });
  });
  it("a device east of UTC (latest row tomorrow) counts that row; today's older row is not double counted", () => {
    const s = summarizeToday(input([dev("a")], [row("a", "2026-10-02", 30), row("a", "2026-10-01", 500)], { a: FRESH }), NOW);
    expect(s.totalMinutes).toBe(30);
    expect(s.reporting).toBe(1);
  });
  it("rows beyond the one-day slack are ignored", () => {
    const s = summarizeToday(input([dev("a")], [row("a", "2026-10-03", 99), row("a", "2026-10-01", 10)], { a: FRESH }), NOW);
    expect(s.totalMinutes).toBe(10);
  });
  it("an explicit 0-minute report is data (0 min), not missing", () => {
    const s = summarizeToday(input([dev("a")], [row("a", "2026-10-01", 0)], { a: FRESH }), NOW);
    expect(s).toMatchObject({ reporting: 1, totalMinutes: 0 });
    expect(todayValue(s)).toBe("0 min");
  });
  it("revoked and pending devices are not counted, even with rows", () => {
    const s = summarizeToday(input([dev("a"), dev("r", "REVOKED"), dev("p", "PENDING")], [row("a", "2026-10-01", 20), row("r", "2026-10-01", 300), row("p", "2026-10-01", 300)], { a: FRESH, r: FRESH, p: FRESH }), NOW);
    expect(s).toEqual({ active: 1, reporting: 1, waiting: 0, stale: 0, totalMinutes: 20 });
  });
  it("a device that never reported (no or invalid usage_synced_at) is waiting, rows are ignored", () => {
    const s = summarizeToday(input([dev("a"), dev("b"), dev("c")], [row("b", "2026-10-01", 80)], { a: null, b: "not a date" }), NOW);
    expect(s).toEqual({ active: 3, reporting: 0, waiting: 3, stale: 0, totalMinutes: null });
  });
  it("stale = last report older than three upload intervals (boundary)", () => {
    const at = (secs: number) => new Date(NOW.getTime() - secs * 1000).toISOString();
    const limit = DEVICE_USAGE_INTERVAL_SECONDS * 3;
    const rows = [row("a", "2026-10-01", 10)];
    expect(summarizeToday(input([dev("a")], rows, { a: at(limit) }), NOW).stale).toBe(0);
    expect(summarizeToday(input([dev("a")], rows, { a: at(limit + 1) }), NOW).stale).toBe(1);
  });
  it("no devices → all zero", () => {
    expect(summarizeToday(input([], [], {}), NOW)).toEqual({ active: 0, reporting: 0, waiting: 0, stale: 0, totalMinutes: null });
  });
  it("uses the first row per device and day (duplicates are not added twice)", () => {
    const s = summarizeToday(input([dev("a")], [row("a", "2026-10-01", 40), row("a", "2026-10-01", 40)], { a: FRESH }), NOW);
    expect(s.totalMinutes).toBe(40);
  });
});

describe("card text", () => {
  const base: TodaySummary = { active: 2, reporting: 2, waiting: 0, stale: 0, totalMinutes: 125 };
  it("value is formatted minutes, or undefined (dash) without a report", () => {
    expect(todayValue(base)).toBe("2 h 05 min");
    expect(todayValue({ ...base, reporting: 0, totalMinutes: null })).toBeUndefined();
  });
  it("hint says who is included and carries the device-date caveat", () => {
    expect(todayHint(base)).toBe("2 of 2 devices reported today. Each device's own date, so it can differ slightly from yours.");
    expect(todayHint({ ...base, active: 1, reporting: 1 })).toContain("1 of 1 device reported today.");
  });
  it("hint mentions waiting and out-of-date devices only when they exist", () => {
    const h = todayHint({ active: 3, reporting: 1, waiting: 1, stale: 1, totalMinutes: 5 });
    expect(h).toContain("1 of 3 devices reported today.");
    expect(h).toContain("1 waiting for a first report.");
    expect(h).toContain("Some reports may be out of date.");
    expect(todayHint(base)).not.toMatch(/waiting|out of date/);
  });
  it("hint without any report never claims a number", () => {
    expect(todayHint({ active: 0, reporting: 0, waiting: 0, stale: 0, totalMinutes: null })).toBe("Shown once a device is enrolled and reports screen time.");
    expect(todayHint({ active: 2, reporting: 0, waiting: 2, stale: 0, totalMinutes: null })).toBe("No device has reported screen time yet.");
    expect(todayHint({ active: 2, reporting: 0, waiting: 1, stale: 0, totalMinutes: null })).toBe("No device has reported for today yet.");
  });
  it("wording is informational (no secure/safe/protected)", () => {
    for (const s of [base, { ...base, waiting: 1, stale: 1 }]) expect(todayHint(s)).not.toMatch(/\b(secure|safe|protected)\b/i);
  });
});
