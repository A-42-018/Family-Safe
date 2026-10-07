import { describe, expect, it } from "vitest";
import {
  asScheduleRow, asTimezone, DAYS_ERROR, daysText, FIELD, findOverlap, NAME_ERROR, parseScheduleDelete, parseScheduleForm, parseTimezoneForm,
  SAME_TIME_ERROR, scheduleLine, scheduleSummaryText, sortSchedules, TIME_ERROR, timeRangeText, timezoneOptions, timezoneText, toScheduleFormValues,
  type ScheduleRow,
} from "./schedules";

const DEV = "44444444-4444-4444-8444-444444444444";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const raw = (o: Record<string, unknown> = {}) => ({ id: S1, name: "Bedtime", type: "BEDTIME", days: [1, 2, 3], start_time: "21:00:00", end_time: "07:00:00", enabled: true, ...o });
const row = (o: Partial<ScheduleRow> = {}): ScheduleRow => ({ id: S1, name: "Bedtime", type: "BEDTIME", days: [1, 2, 3], startTime: "21:00", endTime: "07:00", enabled: true, ...o });
const form = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  [FIELD.deviceId]: DEV, [FIELD.scheduleId]: "", [FIELD.name]: "  Bedtime ", [FIELD.type]: "BEDTIME", [FIELD.start]: "21:00", [FIELD.end]: "07:00", [FIELD.enabled]: "on",
  [FIELD.day(1)]: "on", [FIELD.day(2)]: "on", ...o,
});

describe("asScheduleRow", () => {
  it("maps a row and cuts seconds from the times", () => expect(asScheduleRow(raw())).toEqual(row()));
  it("sorts the days", () => expect(asScheduleRow(raw({ days: [3, 1, 2] }))?.days).toEqual([1, 2, 3]));
  it.each([
    ["not an object", null], ["bad id", raw({ id: "x" })], ["blank name", raw({ name: "  " })], ["long name", raw({ name: "x".repeat(101) })],
    ["bad type", raw({ type: "NAP" })], ["enabled not boolean", raw({ enabled: "yes" })], ["no days", raw({ days: [] })], ["day 8", raw({ days: [8] })],
    ["duplicate day", raw({ days: [1, 1] })], ["bad time", raw({ start_time: "25:00:00" })], ["start = end", raw({ start_time: "07:00:00" })],
  ])("skips %s", (_n, r) => expect(asScheduleRow(r)).toBeNull());
});

describe("asTimezone", () => {
  it("null = the phone's zone; a valid name passes; anything else is unreadable", () => {
    expect(asTimezone(null)).toBeNull();
    expect(asTimezone("Asia/Dhaka")).toBe("Asia/Dhaka");
    expect(asTimezone("EST")).toBeUndefined();
    expect(asTimezone(5)).toBeUndefined();
    expect(asTimezone(undefined)).toBeUndefined();
  });
});

describe("display", () => {
  it("days", () => {
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(daysText([5, 4, 3, 2, 1])).toBe("Weekdays");
    expect(daysText([6, 7])).toBe("Weekends");
    expect(daysText([1, 3])).toBe("Mon, Wed");
  });
  it("overnight windows say so", () => {
    expect(timeRangeText({ startTime: "21:00", endTime: "07:00" })).toBe("21:00 to 07:00 the next day");
    expect(timeRangeText({ startTime: "08:00", endTime: "15:00" })).toBe("08:00 to 15:00");
    expect(scheduleLine(row({ days: [1, 2, 3, 4, 5] }))).toBe("Weekdays · 21:00 to 07:00 the next day");
  });
  it("summary and ordering", () => {
    expect(scheduleSummaryText([])).toBe("No schedules yet.");
    expect(scheduleSummaryText([row()])).toBe("1 schedule, all on.");
    expect(scheduleSummaryText([row(), row({ id: S2, enabled: false })])).toBe("2 schedules, 1 on.");
    const sorted = sortSchedules([row({ id: S2, type: "CUSTOM" }), row({ id: S1, type: "BEDTIME" })]);
    expect(sorted.map((s) => s.type)).toEqual(["BEDTIME", "CUSTOM"]);
  });
  it("time zone text and options keep an unlisted stored zone", () => {
    expect(timezoneText(null)).toMatch(/phone's own/);
    expect(timezoneText("America/New_York")).toBe("America / New York");
    expect(timezoneOptions("Asia/Thimphu")[0]?.value).toBe("Asia/Thimphu");
    expect(timezoneOptions("UTC").filter((o) => o.value === "UTC")).toHaveLength(1);
    expect(timezoneOptions(null)[0]?.value).toBe("UTC");
  });
});

describe("findOverlap (mirrors SQL: enabled, same type, half-open)", () => {
  const base = { id: null, type: "BEDTIME" as const, days: [1], startTime: "21:00", endTime: "23:00", enabled: true };
  it("finds a clash of the same type", () => expect(findOverlap(base, [row({ days: [1], startTime: "22:00", endTime: "23:30" })])?.id).toBe(S1));
  it("back-to-back windows do not clash", () => expect(findOverlap(base, [row({ days: [1], startTime: "23:00", endTime: "23:30" })])).toBeNull());
  it("a different type, a disabled other, or the schedule itself do not clash", () => {
    expect(findOverlap(base, [row({ type: "SCHOOL", days: [1], startTime: "22:00", endTime: "23:00" })])).toBeNull();
    expect(findOverlap(base, [row({ enabled: false, days: [1], startTime: "22:00", endTime: "23:00" })])).toBeNull();
    expect(findOverlap({ ...base, id: S1 }, [row({ days: [1], startTime: "22:00", endTime: "23:00" })])).toBeNull();
  });
  it("a disabled candidate never clashes", () => expect(findOverlap({ ...base, enabled: false }, [row({ days: [1], startTime: "22:00", endTime: "23:00" })])).toBeNull());
  it("Sunday overnight wraps into Monday", () => {
    const sun = row({ days: [7], startTime: "23:00", endTime: "02:00" });
    expect(findOverlap({ ...base, days: [1], startTime: "00:30", endTime: "01:00" }, [sun])?.id).toBe(S1);
  });
});

describe("parseScheduleForm", () => {
  it("trims the name, orders the days, reads the checkbox", () => {
    const p = parseScheduleForm(form());
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.input).toEqual({ device_id: DEV, schedule_id: null, name: "Bedtime", type: "BEDTIME", days: [1, 2], start_time: "21:00", end_time: "07:00", enabled: true });
  });
  it("an absent enabled box means off; a schedule id is kept", () => {
    const p = parseScheduleForm(form({ [FIELD.enabled]: undefined, [FIELD.scheduleId]: S1 }));
    expect(p.ok && p.input.enabled).toBe(false);
    expect(p.ok && p.input.schedule_id).toBe(S1);
  });
  it("collects field errors and keeps the values", () => {
    const p = parseScheduleForm(form({ [FIELD.name]: " ", [FIELD.day(1)]: "", [FIELD.day(2)]: "", [FIELD.start]: "9:00" }));
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.fieldErrors[FIELD.name]).toEqual([NAME_ERROR]);
      expect(p.fieldErrors[FIELD.days]).toEqual([DAYS_ERROR]);
      expect(p.fieldErrors[FIELD.start]).toEqual([TIME_ERROR]);
      expect(p.values[FIELD.start]).toBe("9:00");
    }
  });
  it("start = end, control characters, bad type and a bad schedule id are rejected", () => {
    const same = parseScheduleForm(form({ [FIELD.end]: "21:00" }));
    expect(!same.ok && same.fieldErrors[FIELD.end]).toEqual([SAME_TIME_ERROR]);
    expect(parseScheduleForm(form({ [FIELD.name]: "a\u0007b" })).ok).toBe(false);
    expect(parseScheduleForm(form({ [FIELD.type]: "NAP" })).ok).toBe(false);
    expect(parseScheduleForm(form({ [FIELD.scheduleId]: "nope" })).ok).toBe(false);
  });
  it("a long name is rejected, 100 characters pass", () => {
    expect(parseScheduleForm(form({ [FIELD.name]: "x".repeat(101) })).ok).toBe(false);
    expect(parseScheduleForm(form({ [FIELD.name]: "x".repeat(100) })).ok).toBe(true);
  });
  it("form values of a stored schedule round-trip", () => {
    const v = toScheduleFormValues(row());
    expect(v[FIELD.day(1)]).toBe("on");
    expect(v[FIELD.day(4)]).toBe("");
    expect(toScheduleFormValues()[FIELD.enabled]).toBe("on");
  });
});

describe("delete and time zone forms", () => {
  it("delete needs two UUIDs", () => {
    expect(parseScheduleDelete({ [FIELD.deviceId]: DEV, [FIELD.scheduleId]: S1 }).ok).toBe(true);
    expect(parseScheduleDelete({ [FIELD.deviceId]: DEV, [FIELD.scheduleId]: "x" }).ok).toBe(false);
  });
  it("empty = the phone's zone, a name is checked for format only, abbreviations fail", () => {
    const empty = parseTimezoneForm({ [FIELD.deviceId]: DEV, [FIELD.timezone]: "" });
    expect(empty.ok && empty.input.timezone).toBeNull();
    const ok = parseTimezoneForm({ [FIELD.deviceId]: DEV, [FIELD.timezone]: "Asia/Dhaka" });
    expect(ok.ok && ok.input.timezone).toBe("Asia/Dhaka");
    expect(parseTimezoneForm({ [FIELD.deviceId]: DEV, [FIELD.timezone]: "EST" }).ok).toBe(false);
  });
});
