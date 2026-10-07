import { DEVICE_USAGE_INTERVAL_SECONDS, DEVICE_USAGE_MAX_APPS, DEVICE_USAGE_MAX_MINUTES } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import { formatLastSeen } from "@/lib/enrollment/format";
import {
  addDays,
  APP_USAGE_COLUMNS,
  asAppUsageRow,
  asDayRow,
  barPercent,
  buildSeries,
  chartScaleMax,
  DAY_USAGE_COLUMNS,
  dayAriaLabel,
  dayLabel,
  hasReportedUsage,
  isUsageStale,
  launchesText,
  minutesText,
  parseUsageDay,
  selectDay,
  shortDayText,
  summaryText,
  topApps,
  unlocksText,
  USAGE_APP_ROW_LIMIT,
  USAGE_DAY_ROW_LIMIT,
  USAGE_SERIES_DAYS,
  USAGE_STALE_SECONDS,
  usageQueryRange,
  usageUpdatedText,
  utcDate,
  weekSummary,
  type AppUsageRow,
  type DayUsageRow,
} from "./usage";

const NOW = new Date("2026-10-01T12:00:00Z");
const day = (d: string, screenMinutes: number, unlocks = 10): DayUsageRow => ({ day: d, screenMinutes, unlocks });
const app = (packageName: string, minutes: number, launches = 1): AppUsageRow => ({ packageName, minutes, launches });

describe("columns and limits", () => {
  it("read only the documented columns (no ids, no timestamps)", () => {
    expect(DAY_USAGE_COLUMNS).toBe("usage_date,total_screen_minutes,unlock_count");
    expect(APP_USAGE_COLUMNS).toBe("package_name,foreground_minutes,launch_count");
  });
  it("limits derive from the contracts", () => {
    expect(USAGE_STALE_SECONDS).toBe(DEVICE_USAGE_INTERVAL_SECONDS * 3);
    expect(USAGE_APP_ROW_LIMIT).toBe(DEVICE_USAGE_MAX_APPS);
    expect(USAGE_DAY_ROW_LIMIT).toBeGreaterThan(USAGE_SERIES_DAYS);
  });
});

describe("row parsing", () => {
  it("accepts well-formed rows", () => {
    expect(asDayRow({ usage_date: "2026-10-01", total_screen_minutes: 95, unlock_count: 12 })).toEqual(day("2026-10-01", 95, 12));
    expect(asAppUsageRow({ package_name: "com.a.b", foreground_minutes: 30, launch_count: 4 })).toEqual(app("com.a.b", 30, 4));
  });
  it("skips unusable rows instead of inventing values", () => {
    for (const bad of [null, "x", {}, { usage_date: "2026-13-01", total_screen_minutes: 1, unlock_count: 1 }, { usage_date: "2026-10-01", total_screen_minutes: -1, unlock_count: 1 }, { usage_date: "2026-10-01", total_screen_minutes: DEVICE_USAGE_MAX_MINUTES + 1, unlock_count: 1 }, { usage_date: "2026-10-01", total_screen_minutes: 1.5, unlock_count: 1 }, { usage_date: "2026-10-01", total_screen_minutes: "5", unlock_count: 1 }]) {
      expect(asDayRow(bad)).toBeNull();
    }
    for (const bad of [null, {}, { package_name: "", foreground_minutes: 1, launch_count: 1 }, { package_name: "a.b", foreground_minutes: null, launch_count: 1 }, { package_name: "a.b", foreground_minutes: 1, launch_count: -2 }]) {
      expect(asAppUsageRow(bad)).toBeNull();
    }
  });
});

describe("dates", () => {
  it("utcDate and addDays use UTC calendar arithmetic across month and year ends", () => {
    expect(utcDate(new Date("2026-10-01T23:59:59Z"))).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("query range = 7 days back to one day ahead of the UTC date", () => {
    expect(usageQueryRange(NOW)).toEqual({ from: "2026-09-24", to: "2026-10-02" });
  });
  it("parseUsageDay accepts only real dates (first value wins, junk → null)", () => {
    expect(parseUsageDay({ day: "2026-09-30" })).toBe("2026-09-30");
    expect(parseUsageDay({ day: ["2026-09-30", "x"] })).toBe("2026-09-30");
    for (const v of ["2026-02-30", "yesterday", "", "2026-9-3", "2026-09-30T00:00:00Z", undefined]) expect(parseUsageDay({ day: v })).toBeNull();
    expect(parseUsageDay({})).toBeNull();
  });
  it("labels are relative to the last day and fixed-English", () => {
    expect(shortDayText("2026-09-28")).toBe("Mon 28 Sep");
    expect(dayLabel("2026-10-01", "2026-10-01")).toBe("Today");
    expect(dayLabel("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(dayLabel("2026-09-28", "2026-10-01")).toBe("Mon 28 Sep");
  });
});

describe("buildSeries", () => {
  it("returns seven consecutive days ending today, oldest first; unreported days stay null (not zero)", () => {
    const s = buildSeries([day("2026-10-01", 50), day("2026-09-29", 0)], NOW);
    expect(s.map((d) => d.day)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(s.find((d) => d.day === "2026-09-29")?.screenMinutes).toBe(0);
    expect(s.find((d) => d.day === "2026-09-30")?.screenMinutes).toBeNull();
    expect(s[6]).toEqual({ day: "2026-10-01", screenMinutes: 50, unlocks: 10 });
  });
  it("a child ahead of UTC (date = UTC tomorrow) moves the window by one day", () => {
    const s = buildSeries([day("2026-10-02", 20), day("2026-10-01", 40)], NOW);
    expect(s[6]?.day).toBe("2026-10-02");
    expect(s[0]?.day).toBe("2026-09-26");
  });
  it("ignores days beyond the contract's one-day slack and duplicate days", () => {
    const s = buildSeries([day("2026-10-09", 99), day("2026-10-01", 10), day("2026-10-01", 77)], NOW);
    expect(s[6]).toEqual({ day: "2026-10-01", screenMinutes: 10, unlocks: 10 });
  });
  it("no rows at all → seven empty days", () => {
    const s = buildSeries([], NOW);
    expect(s.length).toBe(USAGE_SERIES_DAYS);
    expect(s.every((d) => d.screenMinutes === null && d.unlocks === null)).toBe(true);
  });
});

describe("selectDay", () => {
  const s = buildSeries([day("2026-10-01", 5)], NOW);
  it("uses the requested day only when it is inside the window", () => {
    expect(selectDay(s, "2026-09-28")).toBe("2026-09-28");
    expect(selectDay(s, "2026-09-01")).toBe("2026-10-01");
    expect(selectDay(s, "2027-01-01")).toBe("2026-10-01");
    expect(selectDay(s, null)).toBe("2026-10-01");
  });
});

describe("minutes and chart", () => {
  it("minutesText", () => {
    expect(minutesText(0)).toBe("0 min");
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(65)).toBe("1 h 05 min");
    expect(minutesText(DEVICE_USAGE_MAX_MINUTES)).toBe("24 h");
    expect(minutesText(null)).toBe("No data");
    expect(minutesText(-5)).toBe("No data");
    expect(minutesText(2.5)).toBe("No data");
  });
  it("scale is at least one hour; bars never overflow, tiny values stay visible, no data is zero height", () => {
    const small = buildSeries([day("2026-10-01", 5)], NOW);
    expect(chartScaleMax(small)).toBe(60);
    const big = buildSeries([day("2026-10-01", 300), day("2026-09-30", 150)], NOW);
    expect(chartScaleMax(big)).toBe(300);
    expect(barPercent(300, 300)).toBe(100);
    expect(barPercent(150, 300)).toBe(50);
    expect(barPercent(1, 300)).toBe(3);
    expect(barPercent(0, 300)).toBe(0);
    expect(barPercent(null, 300)).toBe(0);
    expect(barPercent(999, 300)).toBe(100);
  });
  it("summary averages only reported days and says so", () => {
    const s = buildSeries([day("2026-10-01", 120), day("2026-09-30", 60), day("2026-09-29", 0)], NOW);
    const w = weekSummary(s);
    expect(w).toEqual({ reportedDays: 3, totalMinutes: 180, averageMinutes: 60 });
    expect(summaryText(w)).toBe("Average 1 h a day over 3 reported days");
    expect(summaryText(weekSummary(buildSeries([day("2026-10-01", 30)], NOW)))).toBe("Average 30 min a day over 1 reported day");
    expect(summaryText(weekSummary(buildSeries([], NOW)))).toBe("No days reported in the last 7 days");
  });
  it("aria labels carry the same information as the bars", () => {
    const s = buildSeries([day("2026-10-01", 65)], NOW);
    expect(dayAriaLabel(s[6]!, "2026-10-01")).toBe("Today, Thu 1 Oct: 1 h 05 min screen time");
    expect(dayAriaLabel(s[5]!, "2026-10-01")).toBe("Yesterday, Wed 30 Sep: no data reported");
    expect(dayAriaLabel(s[0]!, "2026-10-01")).toBe("Fri 25 Sep: no data reported");
  });
});

describe("topApps", () => {
  const labels = new Map([["com.a.chat", "Chat"], ["com.b.game", "  Game\u0007 "]]);
  it("sorts by minutes, launches, package; skips unused apps; adds labels and shares", () => {
    const t = topApps([app("com.z.idle", 0, 0), app("com.b.game", 30, 2), app("com.a.chat", 30, 5), app("com.c.other", 60, 1)], labels, 120);
    expect(t.rows.map((r) => r.packageName)).toEqual(["com.c.other", "com.a.chat", "com.b.game"]);
    expect(t.rows.map((r) => r.name)).toEqual(["com.c.other", "Chat", "Game"]);
    expect(t.rows.map((r) => r.sharePercent)).toEqual([50, 25, 25]);
    expect(t.omitted).toBe(0);
  });
  it("limits the list and counts the rest", () => {
    const many = Array.from({ length: 13 }, (_, i) => app(`com.x.app${String(i).padStart(2, "0")}`, 100 - i));
    const t = topApps(many, new Map(), 500);
    expect(t.rows.length).toBe(10);
    expect(t.omitted).toBe(3);
  });
  it("no share when the day total is unknown or zero; share never exceeds 100", () => {
    expect(topApps([app("com.a.b", 10)], new Map(), null).rows[0]?.sharePercent).toBeNull();
    expect(topApps([app("com.a.b", 10)], new Map(), 0).rows[0]?.sharePercent).toBeNull();
    expect(topApps([app("com.a.b", 10)], new Map(), 5).rows[0]?.sharePercent).toBe(100);
  });
  it("prototype-like package names are safe", () => {
    const t = topApps([app("constructor.__proto__", 5)], new Map(), 5);
    expect(t.rows[0]?.name).toBe("constructor.__proto__");
  });
  it("plural text", () => {
    expect(launchesText(1)).toBe("1 launch");
    expect(launchesText(3)).toBe("3 launches");
    expect(unlocksText(1)).toBe("1 unlock");
    expect(unlocksText(0)).toBe("0 unlocks");
    expect(unlocksText(null)).toBe("No data");
  });
});

describe("report time", () => {
  it("nothing is claimed before the first report", () => {
    expect(hasReportedUsage({ syncedAt: null })).toBe(false);
    expect(hasReportedUsage({ syncedAt: "garbage" })).toBe(false);
    expect(usageUpdatedText({ syncedAt: null }, NOW, formatLastSeen)).toBe("Not reported yet");
  });
  it("Updated N ago, and stale only after three intervals", () => {
    const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
    expect(usageUpdatedText({ syncedAt: ago(7200) }, NOW, formatLastSeen)).toBe("Updated 2 hours ago");
    expect(isUsageStale({ syncedAt: ago(USAGE_STALE_SECONDS) }, NOW)).toBe(false);
    expect(isUsageStale({ syncedAt: ago(USAGE_STALE_SECONDS + 1) }, NOW)).toBe(true);
    expect(isUsageStale({ syncedAt: null }, NOW)).toBe(false);
  });
});
