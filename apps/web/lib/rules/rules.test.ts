import { describe, expect, it } from "vitest";
import {
  asRulesRow, bedtimeText, ENFORCEMENT_NOTE, FIELD, hasAnyLimit, parseMinutes, parseRulesForm, restrictionsHint, restrictionsValue,
  RULES_FORM_KEYS, schoolModeText, summarizeRestrictions, toFormValues, versionText, weekPlan, WEEKDAYS, type RulesRow,
} from "./rules";

const DEV = "11111111-1111-4111-8111-111111111111";
const row = (over: Partial<RulesRow> = {}): RulesRow => ({
  configVersion: 1, dailyLimit: null, overrides: {}, bedtimeEnabled: false, bedtimeStart: null, bedtimeEnd: null, schoolModeEnabled: false, updatedAt: null, ...over,
});
const raw = (over: Record<string, unknown> = {}) => ({
  config_version: 3, daily_screen_limit_minutes: 120, daily_limit_overrides: { "6": 180 }, bedtime_enabled: true, bedtime_start: "21:30:00",
  bedtime_end: "07:00:00", school_mode_enabled: false, updated_at: "2026-09-30T10:00:00Z", ...over,
});
/** A complete, valid submission: default off, every day "default". */
const form = (over: Record<string, string> = {}): Record<string, string> => {
  const f: Record<string, string> = { [FIELD.deviceId]: DEV, [FIELD.defaultMode]: "off", [FIELD.defaultMinutes]: "" };
  for (const { iso } of WEEKDAYS) { f[FIELD.dayMode(iso)] = "default"; f[FIELD.dayMinutes(iso)] = ""; }
  return { ...f, ...over };
};

describe("asRulesRow", () => {
  it("reads a valid row and trims time-of-day to HH:MM", () => {
    expect(asRulesRow(raw())).toEqual({
      configVersion: 3, dailyLimit: 120, overrides: { "6": 180 }, bedtimeEnabled: true, bedtimeStart: "21:30", bedtimeEnd: "07:00",
      schoolModeEnabled: false, updatedAt: "2026-09-30T10:00:00Z",
    });
  });
  it("accepts a null limit, an empty override object and missing timestamps", () => {
    expect(asRulesRow(raw({ daily_screen_limit_minutes: null, daily_limit_overrides: {}, updated_at: null, bedtime_enabled: false, bedtime_start: null, bedtime_end: null })))
      .toMatchObject({ dailyLimit: null, overrides: {}, updatedAt: null, bedtimeStart: null });
  });
  it("skips unusable rows instead of inventing values", () => {
    for (const bad of [
      null, "x", 5, [], raw({ config_version: 0 }), raw({ config_version: 1.5 }), raw({ config_version: "2" }), raw({ daily_screen_limit_minutes: 1441 }),
      raw({ daily_screen_limit_minutes: -1 }), raw({ daily_screen_limit_minutes: "60" }), raw({ daily_limit_overrides: { "8": 10 } }),
      raw({ daily_limit_overrides: { "1": 1441 } }), raw({ daily_limit_overrides: null }), raw({ bedtime_enabled: "yes" }), raw({ school_mode_enabled: null }),
    ]) expect(asRulesRow(bad)).toBeNull();
  });
  it("an unreadable time becomes null, not a guess", () => {
    expect(asRulesRow(raw({ bedtime_start: "25:00:00" }))).toMatchObject({ bedtimeStart: null });
  });
});

describe("parseMinutes", () => {
  it("accepts whole minutes 1..1440, trimming outer spaces", () => {
    for (const [t, n] of [["1", 1], ["90", 90], [" 90 ", 90], ["1440", 1440], ["0090", 90]] as const) expect(parseMinutes(t)).toBe(n);
  });
  it("rejects everything else", () => {
    for (const t of ["", " ", "0", "1441", "9.5", "-5", "+5", "1e3", "9 0", "12345", "abc", "０９０", "0x10"]) expect(parseMinutes(t)).toBeNull();
  });
});

describe("toFormValues ↔ parseRulesForm", () => {
  it("maps stored rules to form fields", () => {
    const v = toFormValues({ dailyLimit: 120, overrides: { "6": 180, "7": 0 } });
    expect(v[FIELD.defaultMode]).toBe("limit");
    expect(v[FIELD.defaultMinutes]).toBe("120");
    expect(v[FIELD.dayMode(6)]).toBe("limit");
    expect(v[FIELD.dayMinutes(6)]).toBe("180");
    expect(v[FIELD.dayMode(7)]).toBe("zero");
    expect(v[FIELD.dayMinutes(7)]).toBe("");
    expect(v[FIELD.dayMode(1)]).toBe("default");
  });
  it("no limit and a zero default are distinct", () => {
    expect(toFormValues({ dailyLimit: null, overrides: {} })[FIELD.defaultMode]).toBe("off");
    expect(toFormValues({ dailyLimit: 0, overrides: {} })[FIELD.defaultMode]).toBe("zero");
  });
  it("round-trips exactly for a set of stored states", () => {
    const samples = [
      { dailyLimit: null, overrides: {} },
      { dailyLimit: 0, overrides: {} },
      { dailyLimit: 1440, overrides: { "1": 1, "2": 0, "3": 1440, "4": 59, "5": 60, "6": 61, "7": 0 } },
      { dailyLimit: null, overrides: { "7": 30 } },
    ];
    for (const s of samples) {
      const parsed = parseRulesForm({ [FIELD.deviceId]: DEV, ...toFormValues(s) });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.input).toEqual({ device_id: DEV, daily_limit_minutes: s.dailyLimit, daily_limit_overrides: s.overrides });
    }
  });
});

describe("parseRulesForm", () => {
  it("default off with no overrides → null limit and an empty object", () => {
    const p = parseRulesForm(form());
    expect(p).toMatchObject({ ok: true, input: { device_id: DEV, daily_limit_minutes: null, daily_limit_overrides: {} } });
  });
  it("builds the limit and the overrides", () => {
    const p = parseRulesForm(form({ [FIELD.defaultMode]: "limit", [FIELD.defaultMinutes]: "120", [FIELD.dayMode(6)]: "limit", [FIELD.dayMinutes(6)]: "180", [FIELD.dayMode(7)]: "zero" }));
    expect(p).toMatchObject({ ok: true, input: { daily_limit_minutes: 120, daily_limit_overrides: { "6": 180, "7": 0 } } });
  });
  it("minutes boxes are ignored unless the mode is Limit", () => {
    const p = parseRulesForm(form({ [FIELD.defaultMinutes]: "abc", [FIELD.dayMinutes(2)]: "9999", [FIELD.dayMode(3)]: "zero", [FIELD.dayMinutes(3)]: "zzz" }));
    expect(p).toMatchObject({ ok: true, input: { daily_limit_minutes: null, daily_limit_overrides: { "3": 0 } } });
  });
  it("reports one field error per bad minutes box and keeps every submitted value", () => {
    const p = parseRulesForm(form({ [FIELD.defaultMode]: "limit", [FIELD.defaultMinutes]: "", [FIELD.dayMode(1)]: "limit", [FIELD.dayMinutes(1)]: "1441", [FIELD.dayMode(2)]: "limit", [FIELD.dayMinutes(2)]: "45" }));
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(Object.keys(p.fieldErrors).sort()).toEqual([FIELD.dayMinutes(1), FIELD.defaultMinutes].sort());
      expect(p.fieldErrors[FIELD.dayMinutes(1)]?.[0]).toMatch(/1 to 1440/);
      expect(p.values[FIELD.dayMinutes(2)]).toBe("45");
      expect(p.values[FIELD.dayMinutes(1)]).toBe("1441");
    }
  });
  it("a tampered or missing mode is a form error, not a silent default", () => {
    for (const over of [{ [FIELD.defaultMode]: "maybe" }, { [FIELD.dayMode(4)]: "block" }, { [FIELD.dayMode(5)]: "" }]) {
      const p = parseRulesForm(form(over));
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.formError).toBeTruthy();
    }
  });
  it("a bad device id never passes", () => {
    const p = parseRulesForm(form({ [FIELD.deviceId]: "not-a-uuid" }));
    expect(p.ok).toBe(false);
  });
  it("only known keys are kept in the echoed values", () => {
    const p = parseRulesForm({ ...form(), config_version: "99", evil: "x" });
    expect(Object.keys(p.values).every((k) => RULES_FORM_KEYS.includes(k))).toBe(true);
    expect(p.values).not.toHaveProperty("config_version");
  });
  it("non-string values are treated as empty", () => {
    const p = parseRulesForm({ ...form(), [FIELD.defaultMode]: 5 as unknown as string });
    expect(p.ok).toBe(false);
  });
});

describe("weekPlan", () => {
  it("override beats the default; absent = default; null default = no limit", () => {
    const plan = weekPlan({ dailyLimit: 120, overrides: { "6": 180, "7": 0 } });
    expect(plan.map((d) => d.text)).toEqual(["2 h", "2 h", "2 h", "2 h", "2 h", "3 h", "No screen time"]);
    expect(plan.map((d) => d.source)).toEqual(["default", "default", "default", "default", "default", "override", "override"]);
    expect(weekPlan({ dailyLimit: null, overrides: { "1": 45 } }).map((d) => d.text)).toEqual(["45 min", "No limit", "No limit", "No limit", "No limit", "No limit", "No limit"]);
  });
  it("lists Monday first", () => {
    expect(weekPlan({ dailyLimit: null, overrides: {} }).map((d) => d.label)[0]).toBe("Monday");
  });
});

describe("display helpers", () => {
  it("hasAnyLimit counts a default or any override (even 0)", () => {
    expect(hasAnyLimit(row())).toBe(false);
    expect(hasAnyLimit(row({ dailyLimit: 0 }))).toBe(true);
    expect(hasAnyLimit(row({ overrides: { "3": 0 } }))).toBe(true);
  });
  it("bedtime and school mode text", () => {
    expect(bedtimeText(row())).toBe("Off");
    expect(bedtimeText(row({ bedtimeEnabled: true, bedtimeStart: "21:30", bedtimeEnd: "07:00" }))).toBe("On, 21:30 to 07:00");
    expect(bedtimeText(row({ bedtimeEnabled: true }))).toBe("Off"); // never invent times
    expect(schoolModeText(row({ schoolModeEnabled: true }))).toBe("On");
  });
  it("versionText shows the version and, when usable, how long ago it changed", () => {
    const now = new Date("2026-09-30T10:05:00Z");
    expect(versionText({ configVersion: 3, updatedAt: "2026-09-30T10:00:00Z" }, now)).toBe("Settings version 3 · updated 5 minutes ago");
    expect(versionText({ configVersion: 1, updatedAt: null }, now)).toBe("Settings version 1");
    expect(versionText({ configVersion: 2, updatedAt: "garbage" }, now)).toBe("Settings version 2");
  });
  it("copy is honest about what the phone can and cannot do", () => {
    expect(ENFORCEMENT_NOTE).toMatch(/does not let this app lock the phone/);
    expect(ENFORCEMENT_NOTE).toMatch(/does not report a reached limit to you yet/);
    expect(ENFORCEMENT_NOTE).toMatch(/Schedules are shown to your child the same way/);
    expect(ENFORCEMENT_NOTE).not.toMatch(/not applied/);
    expect(ENFORCEMENT_NOTE).not.toMatch(/\b(secure|safe|protected)\b/i);
    expect(ENFORCEMENT_NOTE).not.toMatch(/guaranteed|cannot be bypassed|locked out/i);
  });
});

describe("summarizeRestrictions", () => {
  const dev = (id: string, enrollmentStatus: "PENDING" | "ENROLLED" | "REVOKED" = "ENROLLED") => ({ id, enrollmentStatus });
  it("counts enrolled devices with a limit, bedtime or school mode; revoked and pending are left out", () => {
    const rules = new Map<string, RulesRow>([
      ["a", row({ dailyLimit: 60 })],
      ["b", row({ bedtimeEnabled: true, bedtimeStart: "21:00", bedtimeEnd: "07:00" })],
      ["c", row({ schoolModeEnabled: true, overrides: { "1": 30 } })],
      ["d", row()],
      ["r", row({ dailyLimit: 30 })],
      ["p", row({ dailyLimit: 30 })],
    ]);
    const s = summarizeRestrictions({ devices: [dev("a"), dev("b"), dev("c"), dev("d"), dev("r", "REVOKED"), dev("p", "PENDING")], rules });
    expect(s).toEqual({ enrolled: 4, restricted: 3, limits: 2, bedtime: 1, school: 1, appRules: 0, schedules: 0, unknown: 0 });
    expect(restrictionsValue(s)).toBe("3");
    expect(restrictionsHint(s)).toBe("3 of 4 enrolled devices have a screen-time limit, bedtime, school mode, schedule or app restriction set. These are settings; the child's app can show a notice, but it can't lock a phone.");
  });
  it("an unreadable device is not counted as unrestricted", () => {
    const s = summarizeRestrictions({ devices: [dev("a"), dev("b")], rules: new Map([["a", row({ dailyLimit: 10 })]]) });
    expect(s).toMatchObject({ enrolled: 2, restricted: 1, unknown: 1 });
    expect(restrictionsHint(s)).toContain("1 could not be read.");
    expect(restrictionsHint(s)).toContain("1 of 1 enrolled device has");
  });
  it("app rules count as a restriction on their own and are never confused with unreadable rules (Phase 18b)", () => {
    const rules = new Map<string, RulesRow>([["a", row()], ["b", row({ dailyLimit: 30 })]]);
    const s = summarizeRestrictions({ devices: [dev("a"), dev("b"), dev("c"), dev("d"), dev("r", "REVOKED")], rules, appRuleCounts: new Map([["a", 2], ["b", 1], ["c", 3], ["r", 5]]) });
    // a: app rules only · b: limit + app rules · c: rules unreadable but app rules known · d: nothing known
    expect(s).toEqual({ enrolled: 4, restricted: 3, limits: 1, bedtime: 0, school: 0, appRules: 3, schedules: 0, unknown: 1 });
    expect(restrictionsValue(s)).toBe("3");
    expect(restrictionsHint(s)).toContain("3 of 3 enrolled devices have");
    expect(restrictionsHint(s)).toContain("1 could not be read.");
  });
  it("enabled schedules count as a restriction and are never confused with unreadable rules (Phase 19b)", () => {
    const rules = new Map<string, RulesRow>([["a", row()], ["b", row({ dailyLimit: 30 })]]);
    const s = summarizeRestrictions({ devices: [dev("a"), dev("b"), dev("c"), dev("d"), dev("r", "REVOKED")], rules, scheduleCounts: new Map([["a", 1], ["b", 2], ["c", 1], ["r", 4]]) });
    // a: schedule only · b: limit + schedules · c: rules unreadable but a schedule is known · d: nothing known
    expect(s).toEqual({ enrolled: 4, restricted: 3, limits: 1, bedtime: 0, school: 0, appRules: 0, schedules: 3, unknown: 1 });
    expect(restrictionsValue(s)).toBe("3");
  });
  it("without appRuleCounts nothing changes (old callers)", () => {
    const s = summarizeRestrictions({ devices: [dev("a")], rules: new Map([["a", row()]]) });
    expect(s).toMatchObject({ restricted: 0, appRules: 0, unknown: 0 });
  });
  it("shows a dash when nothing can be said", () => {
    expect(restrictionsValue(summarizeRestrictions({ devices: [], rules: new Map() }))).toBeUndefined();
    expect(restrictionsHint(summarizeRestrictions({ devices: [], rules: new Map() }))).toMatch(/appear here/);
    const allUnknown = summarizeRestrictions({ devices: [dev("a")], rules: new Map() });
    expect(restrictionsValue(allUnknown)).toBeUndefined();
    expect(restrictionsHint(allUnknown)).toBe("The rules of your enrolled devices could not be read.");
    expect(restrictionsValue(summarizeRestrictions({ devices: [dev("a", "REVOKED")], rules: new Map() }))).toBeUndefined();
  });
  it("zero restricted devices is a real 0, not a dash", () => {
    const s = summarizeRestrictions({ devices: [dev("a")], rules: new Map([["a", row()]]) });
    expect(restrictionsValue(s)).toBe("0");
  });
});
