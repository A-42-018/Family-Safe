import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_RULES_MAX,
  APP_RULE_OUTCOMES,
  CHILD_APP_PACKAGE,
  CONFIG_ETAG_MAX_VERSION,
  DAILY_LIMIT_MAX_MINUTES,
  DEVICE_CONFIG_INTERVAL_SECONDS,
  SCHEDULES_MAX,
  SCHEDULE_DELETE_OUTCOMES,
  SCHEDULE_NAME_MAX,
  SCHEDULE_SAVE_OUTCOMES,
  SCHEDULE_TYPES,
  SYNC_CONFIG_COMMAND,
  SYNC_CONFIG_TTL_HOURS,
  TIMEZONE_NAME_PATTERN,
  TIMEZONE_OUTCOMES,
  appRuleInputSchema,
  appRuleSchema,
  dayLimitOverridesSchema,
  deviceConfigSchema,
  effectiveDailyLimitMinutes,
  etagForConfigVersion,
  isTimezoneNameFormat,
  parseConfigEtag,
  scheduleDeleteInputSchema,
  scheduleInputSchema,
  scheduleSchema,
  scheduleWeekRanges,
  schedulesOverlap,
  screenTimeRulesInputSchema,
  timezoneInputSchema,
  timezoneSchema,
} from "./device-config";

const DEVICE = "d0000000-0000-4000-8000-0000000000aa";
const CONFIG = {
  config_version: 3,
  daily_limit_minutes: 120,
  daily_limit_overrides: { "6": 240, "7": 0 },
  app_rules: [] as unknown[],
  timezone: null as string | null,
  schedules: [] as unknown[],
  server_time: "2026-10-01T12:00:00.000Z",
  next_interval_seconds: DEVICE_CONFIG_INTERVAL_SECONDS,
};

describe("dayLimitOverridesSchema", () => {
  it("accepts empty, partial and full weekday maps", () => {
    expect(dayLimitOverridesSchema.safeParse({}).success).toBe(true);
    expect(dayLimitOverridesSchema.safeParse({ "6": 240 }).success).toBe(true);
    expect(dayLimitOverridesSchema.safeParse({ "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 1440 }).success).toBe(true);
  });
  it("rejects unknown weekdays, out-of-range, fractional, negative and non-numeric values", () => {
    for (const bad of [{ "0": 10 }, { "8": 10 }, { mon: 10 }, { "1": 1441 }, { "1": -1 }, { "1": 1.5 }, { "1": "60" }, { "1": null }, { "1": NaN }]) {
      expect(dayLimitOverridesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("screenTimeRulesInputSchema", () => {
  const ok = { device_id: DEVICE, daily_limit_minutes: 90, daily_limit_overrides: { "7": 180 } };
  it("accepts a limit, a null (no limit) and the bounds", () => {
    expect(screenTimeRulesInputSchema.safeParse(ok).success).toBe(true);
    expect(screenTimeRulesInputSchema.safeParse({ ...ok, daily_limit_minutes: null }).success).toBe(true);
    expect(screenTimeRulesInputSchema.safeParse({ ...ok, daily_limit_minutes: 0 }).success).toBe(true);
    expect(screenTimeRulesInputSchema.safeParse({ ...ok, daily_limit_minutes: DAILY_LIMIT_MAX_MINUTES }).success).toBe(true);
  });
  it("rejects bad limits, bad ids, missing and extra fields", () => {
    for (const bad of [
      { ...ok, daily_limit_minutes: 1441 },
      { ...ok, daily_limit_minutes: -5 },
      { ...ok, daily_limit_minutes: 1.5 },
      { ...ok, daily_limit_minutes: "90" },
      { ...ok, device_id: "nope" },
      { ...ok, extra: 1 },
      { device_id: DEVICE, daily_limit_minutes: 90 },
      { device_id: DEVICE, daily_limit_overrides: {} },
    ]) {
      expect(screenTimeRulesInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("deviceConfigSchema", () => {
  it("accepts a full config and a minimal one", () => {
    expect(deviceConfigSchema.safeParse(CONFIG).success).toBe(true);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, daily_limit_minutes: null, daily_limit_overrides: {} }).success).toBe(true);
  });
  it("the legacy bedtime and school-mode keys are gone: they are extra keys now (strict)", () => {
    for (const legacy of [{ bedtime_enabled: false }, { bedtime_start: null }, { bedtime_end: null }, { school_mode_enabled: false }]) {
      expect(deviceConfigSchema.safeParse({ ...CONFIG, ...legacy }).success).toBe(false);
    }
  });
  it("rejects malformed times, versions, extra keys and a wrong interval", () => {
    for (const bad of [
      { ...CONFIG, config_version: 0 },
      { ...CONFIG, config_version: 1.5 },
      { ...CONFIG, device_id: DEVICE },
      { ...CONFIG, next_interval_seconds: 60 },
      { ...CONFIG, server_time: "yesterday" },
    ]) {
      expect(deviceConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

const RULE = { package_name: "com.example.game", blocked: true, daily_limit_minutes: null };

describe("appRuleSchema (what the device receives)", () => {
  it("accepts a block, a limit, a block that keeps a limit, and the bounds", () => {
    for (const r of [
      RULE,
      { ...RULE, blocked: false, daily_limit_minutes: 45 },
      { ...RULE, blocked: true, daily_limit_minutes: 20 },
      { ...RULE, blocked: false, daily_limit_minutes: 0 },
      { ...RULE, blocked: false, daily_limit_minutes: DAILY_LIMIT_MAX_MINUTES },
    ]) expect(appRuleSchema.safeParse(r).success, JSON.stringify(r)).toBe(true);
  });
  it("a rule must restrict something (not blocked and no limit is rejected)", () => {
    expect(appRuleSchema.safeParse({ ...RULE, blocked: false, daily_limit_minutes: null }).success).toBe(false);
  });
  it("rejects bad limits, bad packages, labels, missing and extra keys", () => {
    for (const bad of [
      { ...RULE, blocked: false, daily_limit_minutes: -1 }, { ...RULE, blocked: false, daily_limit_minutes: DAILY_LIMIT_MAX_MINUTES + 1 },
      { ...RULE, blocked: false, daily_limit_minutes: 1.5 }, { ...RULE, blocked: false, daily_limit_minutes: "20" },
      { ...RULE, package_name: "nodots" }, { ...RULE, package_name: "com..x" }, { ...RULE, package_name: `com.${"a".repeat(260)}` },
      { ...RULE, blocked: "yes" }, { ...RULE, blocked: undefined }, { package_name: RULE.package_name, blocked: true },
      { ...RULE, app_name: "Game" }, { ...RULE, label: "Game" },
    ]) expect(appRuleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("the child app itself can never be restricted", () => {
    expect(appRuleSchema.safeParse({ ...RULE, package_name: CHILD_APP_PACKAGE }).success).toBe(false);
    expect(appRuleSchema.safeParse({ ...RULE, package_name: `${CHILD_APP_PACKAGE}.debug` }).success).toBe(true);
  });
});

describe("appRuleInputSchema (parent input)", () => {
  const input = { device_id: DEVICE, ...RULE };
  it("accepts a block, a limit, and the clearing form (not blocked + no limit)", () => {
    expect(appRuleInputSchema.safeParse(input).success).toBe(true);
    expect(appRuleInputSchema.safeParse({ ...input, blocked: false, daily_limit_minutes: 30 }).success).toBe(true);
    expect(appRuleInputSchema.safeParse({ ...input, blocked: false, daily_limit_minutes: null }).success).toBe(true);
  });
  it("rejects bad ids, limits, packages, the child app, missing and extra fields", () => {
    for (const bad of [
      { ...input, device_id: "nope" }, { ...input, device_id: undefined }, { ...input, daily_limit_minutes: 1441 },
      { ...input, daily_limit_minutes: -5 }, { ...input, package_name: "x" }, { ...input, package_name: CHILD_APP_PACKAGE },
      { ...input, app_name: "Game" }, { ...input, child_id: DEVICE },
    ]) expect(appRuleInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("deviceConfigSchema app_rules", () => {
  it("accepts an empty list and up to APP_RULES_MAX unique packages", () => {
    expect(deviceConfigSchema.safeParse(CONFIG).success).toBe(true);
    const many = Array.from({ length: APP_RULES_MAX }, (_, i) => ({ ...RULE, package_name: `com.example.app${i}` }));
    expect(deviceConfigSchema.safeParse({ ...CONFIG, app_rules: many }).success).toBe(true);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, app_rules: [...many, { ...RULE, package_name: "com.example.extra" }] }).success).toBe(false);
  });
  it("rejects duplicate packages, an invalid rule, null and a missing key", () => {
    expect(deviceConfigSchema.safeParse({ ...CONFIG, app_rules: [RULE, { ...RULE, blocked: false, daily_limit_minutes: 5 }] }).success).toBe(false);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, app_rules: [{ ...RULE, blocked: false, daily_limit_minutes: null }] }).success).toBe(false);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, app_rules: null }).success).toBe(false);
    const { app_rules: _omit, ...rest } = CONFIG;
    expect(deviceConfigSchema.safeParse(rest).success).toBe(false);
  });
  it("the cap and the child package match the plan", () => {
    expect(APP_RULES_MAX).toBe(200);
    expect(CHILD_APP_PACKAGE).toBe("app.familysafe.child");
    expect([...APP_RULE_OUTCOMES]).toEqual(["updated", "cleared", "unchanged", "not_found", "inactive", "unknown_app"]);
  });
});

const SCHEDULE_ID = "a0000000-0000-4000-8000-000000000001";
const SCHEDULE_ID_2 = "a0000000-0000-4000-8000-000000000002";
const SCHEDULE = { id: SCHEDULE_ID, name: "Bedtime", type: "BEDTIME", days: [1, 2, 3, 4, 5], start_time: "21:00", end_time: "07:00" };
const SAVE = {
  device_id: DEVICE, schedule_id: null, name: "  Bedtime ", type: "BEDTIME", days: [5, 1, 3],
  start_time: "21:00", end_time: "07:00", enabled: true,
};

describe("timezoneSchema / isTimezoneNameFormat (same rules as SQL is_timezone_name_format)", () => {
  it("accepts UTC and Region/City[/Sub] names", () => {
    for (const z of ["UTC", "Europe/Berlin", "Asia/Dhaka", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "America/Port-au-Prince"]) {
      expect(isTimezoneNameFormat(z), z).toBe(true);
      expect(timezoneSchema.safeParse(z).success, z).toBe(true);
    }
  });
  it("rejects abbreviations, odd trees, bad characters, depth, length and non-strings", () => {
    for (const z of [
      "", "EST", "utc", "Utc", "europe/Berlin", "Europe/", "/Berlin", "Europe//Berlin", "Europe/Berlin/A/B", "Europe/Ber lin",
      "Europe/Berlin\n", "SystemV/EST5EDT", "posix/Europe/Berlin", "right/Europe/Berlin", "Europe/Berlín", `A/${"b".repeat(70)}`, "UTC/",
    ]) expect(isTimezoneNameFormat(z), JSON.stringify(z)).toBe(false);
    for (const z of [null, undefined, 5, {}]) expect(timezoneSchema.safeParse(z).success).toBe(false);
  });
  it("the 64-character boundary", () => {
    expect(isTimezoneNameFormat(`A/${"b".repeat(62)}`)).toBe(true);
    expect(isTimezoneNameFormat(`A/${"b".repeat(63)}`)).toBe(false);
  });
});

describe("scheduleSchema (what the device receives)", () => {
  it("accepts a window, an overnight window, all days and the name bounds", () => {
    for (const s of [
      SCHEDULE,
      { ...SCHEDULE, type: "SCHOOL", start_time: "08:00", end_time: "15:30", days: [1, 2, 3, 4, 5] },
      { ...SCHEDULE, type: "CUSTOM", days: [1, 2, 3, 4, 5, 6, 7] },
      { ...SCHEDULE, name: "x" },
      { ...SCHEDULE, name: "x".repeat(SCHEDULE_NAME_MAX) },
      { ...SCHEDULE, start_time: "00:00", end_time: "23:59" },
    ]) expect(scheduleSchema.safeParse(s).success, JSON.stringify(s)).toBe(true);
  });
  it("rejects bad ids, names, types, days, times, missing and extra keys", () => {
    for (const bad of [
      { ...SCHEDULE, id: "nope" }, { ...SCHEDULE, name: "" }, { ...SCHEDULE, name: " Bedtime" }, { ...SCHEDULE, name: "Bedtime " },
      { ...SCHEDULE, name: "x".repeat(SCHEDULE_NAME_MAX + 1) }, { ...SCHEDULE, name: "Bed\ntime" }, { ...SCHEDULE, type: "bedtime" },
      { ...SCHEDULE, type: "NAP" }, { ...SCHEDULE, days: [] }, { ...SCHEDULE, days: [0] }, { ...SCHEDULE, days: [8] },
      { ...SCHEDULE, days: [1, 1] }, { ...SCHEDULE, days: [3, 1] }, { ...SCHEDULE, days: [1.5] }, { ...SCHEDULE, days: [1, 2, 3, 4, 5, 6, 7, 1] },
      { ...SCHEDULE, start_time: "24:00" }, { ...SCHEDULE, start_time: "9:00" }, { ...SCHEDULE, start_time: "21:00:00" },
      { ...SCHEDULE, end_time: "07:60" }, { ...SCHEDULE, end_time: null }, { ...SCHEDULE, start_time: "07:00" },
      { ...SCHEDULE, enabled: true }, { ...SCHEDULE, id: undefined }, { ...SCHEDULE, days: undefined },
    ]) expect(scheduleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("scheduleInputSchema (parent input for parent_save_schedule)", () => {
  it("accepts a create and an update; trims the name; days may arrive unsorted", () => {
    const create = scheduleInputSchema.safeParse(SAVE);
    expect(create.success).toBe(true);
    expect(create.success && create.data.name).toBe("Bedtime");
    expect(scheduleInputSchema.safeParse({ ...SAVE, schedule_id: SCHEDULE_ID, enabled: false }).success).toBe(true);
  });
  it("rejects bad ids, blank/control names, bad types, days, times, enabled, missing and extra fields", () => {
    for (const bad of [
      { ...SAVE, device_id: "nope" }, { ...SAVE, device_id: undefined }, { ...SAVE, schedule_id: "x" }, { ...SAVE, schedule_id: undefined },
      { ...SAVE, name: "   " }, { ...SAVE, name: "" }, { ...SAVE, name: "x".repeat(SCHEDULE_NAME_MAX + 1) }, { ...SAVE, name: "a\tb" },
      { ...SAVE, name: "a\u0085b" }, { ...SAVE, type: "NAP" }, { ...SAVE, days: [] }, { ...SAVE, days: [1, 1] }, { ...SAVE, days: [0, 1] },
      { ...SAVE, start_time: "21:00", end_time: "21:00" }, { ...SAVE, start_time: "25:00" }, { ...SAVE, end_time: "7:00" },
      { ...SAVE, enabled: undefined }, { ...SAVE, enabled: "yes" }, { ...SAVE, child_id: DEVICE }, { ...SAVE, timezone: "UTC" },
    ]) expect(scheduleInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("a name that is only spaces after trimming never reaches 1 character", () => {
    expect(scheduleInputSchema.safeParse({ ...SAVE, name: " ".repeat(5) }).success).toBe(false);
    expect(scheduleInputSchema.safeParse({ ...SAVE, name: ` ${"x".repeat(SCHEDULE_NAME_MAX)} ` }).success).toBe(true); // length is checked after trimming, like SQL
  });
});

describe("scheduleDeleteInputSchema / timezoneInputSchema", () => {
  it("delete: both ids, nothing else", () => {
    expect(scheduleDeleteInputSchema.safeParse({ device_id: DEVICE, schedule_id: SCHEDULE_ID }).success).toBe(true);
    for (const bad of [{ device_id: DEVICE }, { schedule_id: SCHEDULE_ID }, { device_id: "x", schedule_id: SCHEDULE_ID },
      { device_id: DEVICE, schedule_id: null }, { device_id: DEVICE, schedule_id: SCHEDULE_ID, extra: 1 }]) {
      expect(scheduleDeleteInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("timezone: a valid name or null (follow the device); nothing else", () => {
    expect(timezoneInputSchema.safeParse({ device_id: DEVICE, timezone: "Asia/Dhaka" }).success).toBe(true);
    expect(timezoneInputSchema.safeParse({ device_id: DEVICE, timezone: null }).success).toBe(true);
    for (const bad of [{ device_id: DEVICE }, { device_id: DEVICE, timezone: "EST" }, { device_id: DEVICE, timezone: "" },
      { device_id: "x", timezone: null }, { device_id: DEVICE, timezone: "UTC", extra: 1 }]) {
      expect(timezoneInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("scheduleWeekRanges / schedulesOverlap (mirror SQL schedule_week_ranges)", () => {
  it("a same-day window is one range per day", () => {
    expect(scheduleWeekRanges([1], "08:00", "15:00")).toEqual([[480, 900]]);
    expect(scheduleWeekRanges([2], "00:00", "00:01")).toEqual([[1440, 1441]]);
  });
  it("an overnight window belongs to the day it starts on and spills into the next day", () => {
    expect(scheduleWeekRanges([1], "21:00", "07:00")).toEqual([[1260, 1860]]);
  });
  it("an overnight window on Sunday wraps into Monday", () => {
    expect(scheduleWeekRanges([7], "21:00", "07:00")).toEqual([[9900, 10080], [0, 420]]);
    expect(scheduleWeekRanges([7], "23:00", "23:30")).toEqual([[10020, 10050]]);
  });
  it("back-to-back windows do not overlap (half-open), a one-minute shared edge does", () => {
    expect(schedulesOverlap({ days: [1], start_time: "08:00", end_time: "12:00" }, { days: [1], start_time: "12:00", end_time: "15:00" })).toBe(false);
    expect(schedulesOverlap({ days: [1], start_time: "08:00", end_time: "12:01" }, { days: [1], start_time: "12:00", end_time: "15:00" })).toBe(true);
  });
  it("different days never overlap, except an overnight spill into the next day", () => {
    expect(schedulesOverlap({ days: [1], start_time: "08:00", end_time: "15:00" }, { days: [2], start_time: "08:00", end_time: "15:00" })).toBe(false);
    expect(schedulesOverlap({ days: [1], start_time: "21:00", end_time: "07:00" }, { days: [2], start_time: "06:00", end_time: "09:00" })).toBe(true);
    expect(schedulesOverlap({ days: [1], start_time: "21:00", end_time: "07:00" }, { days: [2], start_time: "07:00", end_time: "09:00" })).toBe(false);
  });
  it("Sunday night collides with Monday morning (wrap) and not with Monday afternoon", () => {
    expect(schedulesOverlap({ days: [7], start_time: "22:00", end_time: "06:00" }, { days: [1], start_time: "05:00", end_time: "08:00" })).toBe(true);
    expect(schedulesOverlap({ days: [7], start_time: "22:00", end_time: "06:00" }, { days: [1], start_time: "13:00", end_time: "14:00" })).toBe(false);
  });
});

describe("deviceConfigSchema timezone + schedules", () => {
  it("accepts a zone, null, an empty list and up to SCHEDULES_MAX non-overlapping windows", () => {
    expect(deviceConfigSchema.safeParse({ ...CONFIG, timezone: "Asia/Dhaka", schedules: [SCHEDULE] }).success).toBe(true);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, timezone: null, schedules: [] }).success).toBe(true);
    const many = Array.from({ length: SCHEDULES_MAX }, (_, i) => ({
      ...SCHEDULE, id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, type: "CUSTOM",
      days: [1], start_time: `${String(i).padStart(2, "0")}:00`, end_time: `${String(i).padStart(2, "0")}:30`,
    }));
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: many }).success).toBe(true);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: [...many, { ...many[0], id: SCHEDULE_ID_2, start_time: "23:00", end_time: "23:30" }] }).success).toBe(false);
  });
  it("different types may overlap, the same type may not", () => {
    const school = { ...SCHEDULE, id: SCHEDULE_ID_2, type: "SCHOOL", start_time: "08:00", end_time: "15:00" };
    const nap = { ...SCHEDULE, id: SCHEDULE_ID_2, type: "BEDTIME", days: [1], start_time: "22:00", end_time: "23:00" };
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: [{ ...SCHEDULE, start_time: "07:30", end_time: "09:00" }, school] }).success).toBe(true);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: [SCHEDULE, nap] }).success).toBe(false);
  });
  it("rejects duplicate ids, a bad zone, null/missing keys and an invalid window", () => {
    const other = { ...SCHEDULE, type: "SCHOOL", start_time: "08:00", end_time: "15:00" };
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: [SCHEDULE, other] }).success).toBe(false); // same id
    expect(deviceConfigSchema.safeParse({ ...CONFIG, timezone: "EST" }).success).toBe(false);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, timezone: "" }).success).toBe(false);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: null }).success).toBe(false);
    expect(deviceConfigSchema.safeParse({ ...CONFIG, schedules: [{ ...SCHEDULE, start_time: "07:00" }] }).success).toBe(false);
    const { timezone: _tz, ...noTz } = CONFIG;
    const { schedules: _sch, ...noSchedules } = CONFIG;
    expect(deviceConfigSchema.safeParse(noTz).success).toBe(false);
    expect(deviceConfigSchema.safeParse(noSchedules).success).toBe(false);
  });
  it("constants match the plan", () => {
    expect(SCHEDULES_MAX).toBe(20);
    expect(SCHEDULE_NAME_MAX).toBe(100);
    expect([...SCHEDULE_TYPES]).toEqual(["BEDTIME", "SCHOOL", "CUSTOM"]);
  });
});

describe("effectiveDailyLimitMinutes", () => {
  const cfg = { daily_limit_minutes: 120 as number | null, daily_limit_overrides: { "6": 240, "7": 0 } };
  it("an override beats the default, an absent override uses the default", () => {
    expect(effectiveDailyLimitMinutes(cfg, 6)).toBe(240);
    expect(effectiveDailyLimitMinutes(cfg, 1)).toBe(120);
  });
  it("an override of 0 means no screen time, not no limit", () => {
    expect(effectiveDailyLimitMinutes(cfg, 7)).toBe(0);
  });
  it("null default = no limit unless that weekday is overridden", () => {
    expect(effectiveDailyLimitMinutes({ ...cfg, daily_limit_minutes: null }, 1)).toBeNull();
    expect(effectiveDailyLimitMinutes({ ...cfg, daily_limit_minutes: null }, 6)).toBe(240);
  });
});

describe("ETag helpers", () => {
  it("round-trip and reject anything that is not exactly one version tag", () => {
    expect(etagForConfigVersion(3)).toBe('"v3"');
    expect(parseConfigEtag('"v3"')).toBe(3);
    expect(parseConfigEtag('W/"v3"')).toBe(3);
    expect(parseConfigEtag(null)).toBeNull();
    for (const bad of ["*", '"v0"', '"v03"', "v3", '"3"', '"v3", "v4"', '"v-1"', `"v${CONFIG_ETAG_MAX_VERSION + 1}"`, ""]) {
      expect(parseConfigEtag(bad), bad).toBeNull();
    }
    expect(parseConfigEtag(`"v${CONFIG_ETAG_MAX_VERSION}"`)).toBe(CONFIG_ETAG_MAX_VERSION);
  });
});

describe("constants", () => {
  it("match the plan", () => {
    expect(DEVICE_CONFIG_INTERVAL_SECONDS).toBe(21600);
    expect(DAILY_LIMIT_MAX_MINUTES).toBe(1440);
    expect(SYNC_CONFIG_COMMAND).toBe("SYNC_CONFIG");
    expect(SYNC_CONFIG_TTL_HOURS).toBe(24);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-config.ts) has not drifted", () => {
  const edge = readFileSync(new URL("../../../supabase/functions/_shared/device-config.ts", import.meta.url), "utf8");
  const src = readFileSync(new URL("./device-config.ts", import.meta.url), "utf8");
  it("interval constant matches", () => {
    expect(edge).toContain(`export const DEVICE_CONFIG_INTERVAL_SECONDS = ${DEVICE_CONFIG_INTERVAL_SECONDS};`);
  });
  it("app-rule and schedule caps match", () => {
    expect(edge).toContain(`export const APP_RULES_MAX = ${APP_RULES_MAX};`);
    expect(edge).toContain(`export const SCHEDULES_MAX = ${SCHEDULES_MAX};`);
  });
  it("the Edge schedule row has exactly the wire keys of scheduleSchema", () => {
    const iface = /interface ScheduleRow \{([\s\S]*?)\n\}/.exec(edge)?.[1] ?? "";
    const keys = [...iface.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(Object.keys(scheduleSchema._def.schema.shape).sort());
    expect(iface).toContain('"BEDTIME" | "SCHOOL" | "CUSTOM"');
  });
  it("ETag helpers have identical bodies", () => {
    const body = (s: string, name: string) => new RegExp(`export function ${name}\\([^)]*\\): [^{]+ \\{[\\s\\S]*?\\n\\}`).exec(s)?.[0];
    for (const fn of ["etagForConfigVersion", "parseConfigEtag"]) {
      expect(body(src, fn), fn).toBeTruthy();
      expect(body(edge, fn)).toBe(body(src, fn));
    }
  });
  it("the row interface carries exactly the wire keys (minus server_time/next_interval_seconds)", () => {
    const wire = Object.keys(deviceConfigSchema._def.schema.shape).filter((k) => k !== "server_time" && k !== "next_interval_seconds");
    const iface = /interface DeviceConfigRow \{([\s\S]*?)\n\}/.exec(edge)?.[1] ?? "";
    const keys = [...iface.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(wire.sort());
  });
});

describe("SQL (migration 20260930001600_screen_time_rules.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260930001600_screen_time_rules.sql", import.meta.url), "utf8");
  it("same bounds, weekdays, command name and TTL", () => {
    expect(sql).toContain(`> ${DAILY_LIMIT_MAX_MINUTES}`);
    expect(sql).toContain("'^[1-7]$'");
    expect(sql).toContain(`'${SYNC_CONFIG_COMMAND}'`);
    expect(sql).toContain(`interval '${SYNC_CONFIG_TTL_HOURS} hours'`);
  });
  it("the base table already enforces the same limit bounds", () => {
    const base = readFileSync(new URL("../../../supabase/migrations/20260929000300_devices.sql", import.meta.url), "utf8");
    expect(base).toContain(`daily_screen_limit_minutes int check (daily_screen_limit_minutes between 0 and ${DAILY_LIMIT_MAX_MINUTES})`);
  });
  it("wire keys map 1:1 to the SQL output columns", () => {
    const map: Record<string, string> = {
      config_version: "o_config_version", daily_limit_minutes: "o_daily_limit_minutes", daily_limit_overrides: "o_daily_limit_overrides",
    };
    const wire = Object.keys(deviceConfigSchema._def.schema.shape).filter((k) => k !== "server_time" && k !== "next_interval_seconds" && k !== "app_rules" && k !== "timezone" && k !== "schedules");
    expect(wire.sort()).toEqual(Object.keys(map).sort()); // app_rules (18a) and timezone/schedules (19a) are checked against their own migrations below
    for (const col of Object.values(map)) expect(sql).toContain(col);
    const idx = readFileSync(new URL("../../../supabase/functions/device-config/index.ts", import.meta.url), "utf8");
    for (const [k, col] of Object.entries(map)) expect(idx).toContain(`${k}: row.${col}`);
  });
  it("the device read is service_role only and read-only; the parent RPC is authenticated only", () => {
    expect(sql).toMatch(/grant execute on function public\.device_get_config\(uuid\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_get_config\(uuid\) from public, anon, authenticated;/);
    const read = sql.slice(sql.indexOf("create or replace function public.device_get_config"));
    expect(read).not.toMatch(/\b(update|insert|delete)\b\s/i);
    expect(sql).toMatch(/grant execute on function public\.parent_set_screen_time_rules\(uuid, int, jsonb\) to authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.parent_set_screen_time_rules\(uuid, int, jsonb\) from public, anon;/);
  });
  it("the Edge function calls the RPC with the parameter name the SQL declares", () => {
    const idx = readFileSync(new URL("../../../supabase/functions/device-config/index.ts", import.meta.url), "utf8");
    expect(idx).toContain('"device_get_config"');
    expect(idx).toContain("p_device_id: deviceId");
    expect(sql).toContain("device_get_config(p_device_id uuid)");
    expect(idx).toContain('row.o_outcome !== "ok"');
  });
  it("app_rules (Phase 18a): wire key <-> o_app_rules <-> index.ts, cap and package rules agree with the migration", () => {
    const m18 = readFileSync(new URL("../../../supabase/migrations/20260930001700_app_rules.sql", import.meta.url), "utf8");
    const idx = readFileSync(new URL("../../../supabase/functions/device-config/index.ts", import.meta.url), "utf8");
    expect(Object.keys(deviceConfigSchema._def.schema.shape)).toContain("app_rules");
    expect(m18).toContain("o_app_rules");
    expect(idx).toContain("app_rules: row.o_app_rules");
    expect(m18).toContain(`>= ${APP_RULES_MAX}`);
    expect(m18).toContain(`limit ${APP_RULES_MAX}`);
    expect(m18).toContain(`'${CHILD_APP_PACKAGE}'`);
    expect(m18).toContain("> 1440");
    expect(m18).toMatch(/grant execute on function public\.parent_set_app_rule\(uuid, text, boolean, int\) to authenticated;/);
    for (const o of APP_RULE_OUTCOMES) expect(m18).toContain(`'${o}'`);
  });
  it("schedules (Phase 19a): wire keys <-> o_timezone/o_schedules <-> index.ts; cap, types, outcomes, regexes and grants agree with the migration", () => {
    const m19 = readFileSync(new URL("../../../supabase/migrations/20260930001800_schedules.sql", import.meta.url), "utf8");
    const idx = readFileSync(new URL("../../../supabase/functions/device-config/index.ts", import.meta.url), "utf8");
    const keys = Object.keys(deviceConfigSchema._def.schema.shape);
    expect(keys).toContain("timezone");
    expect(keys).toContain("schedules");
    expect(m19).toContain("o_timezone");
    expect(m19).toContain("o_schedules");
    expect(idx).toContain("timezone: row.o_timezone");
    expect(idx).toContain("schedules: row.o_schedules");
    // cap: guard trigger + device read
    expect(m19).toContain(`>= ${SCHEDULES_MAX}`);
    expect(m19).toContain(`limit ${SCHEDULES_MAX}`);
    // types and name bounds
    expect(m19).toContain(`in ('${SCHEDULE_TYPES.join("', '")}')`);
    expect(m19).toContain(`> ${SCHEDULE_NAME_MAX}`);
    // time format and the "device payload carries enabled windows only" rule
    expect(m19).toContain("'^([01][0-9]|2[0-3]):[0-5][0-9]$'");
    expect(m19).toMatch(/where s\.device_id = r\.device_id and s\.enabled/);
    // outcomes
    for (const o of SCHEDULE_SAVE_OUTCOMES) expect(m19, o).toContain(`'${o}'`);
    for (const o of SCHEDULE_DELETE_OUTCOMES) expect(m19, o).toContain(`'${o}'`);
    for (const o of TIMEZONE_OUTCOMES) expect(m19, o).toContain(`'${o}'`);
    // time-zone name format: the SQL regex and the TS pattern are the same text
    expect(m19).toContain("'^[A-Z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'");
    expect(TIMEZONE_NAME_PATTERN.source.replace(/\\\//g, "/")).toBe("^[A-Z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$");
    expect(m19).toContain("char_length(p) between 1 and 64");
    expect(m19).toContain("'^(SystemV|posix|right)/'");
    // week ranges: minutes per day/week
    expect(m19).toContain("* 1440");
    expect(m19).toContain("10080");
    // grants: parent RPCs authenticated only, no direct grant on the new device_rules columns
    expect(m19).toMatch(/grant execute on function public\.parent_save_schedule\(uuid, uuid, text, text, int\[\], text, text, boolean\) to authenticated;/);
    expect(m19).toMatch(/grant execute on function public\.parent_delete_schedule\(uuid, uuid\) to authenticated;/);
    expect(m19).toMatch(/grant execute on function public\.parent_set_device_timezone\(uuid, text\) to authenticated;/);
    expect(m19).toMatch(/grant execute on function public\.device_get_config\(uuid\) to service_role;/);
    expect(m19).toMatch(/revoke all on function public\.device_get_config\(uuid\) from public, anon, authenticated;/);
    const rls = readFileSync(new URL("../../../supabase/migrations/20260929000800_rls_policies.sql", import.meta.url), "utf8");
    expect(rls).not.toContain("schedules_revision");
    expect(rls).not.toContain("timezone");
  });
  it("the parent has no direct grant on the new columns", () => {
    const rls = readFileSync(new URL("../../../supabase/migrations/20260929000800_rls_policies.sql", import.meta.url), "utf8");
    expect(rls).not.toContain("daily_limit_overrides");
    expect(rls).not.toContain("config_version");
  });
});

describe("SQL (migration 20261007000200_drop_legacy_schedule_columns.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000200_drop_legacy_schedule_columns.sql", import.meta.url), "utf8");
  const idx = readFileSync(new URL("../../../supabase/functions/device-config/index.ts", import.meta.url), "utf8");
  const contract = readFileSync(new URL("./device-config.ts", import.meta.url), "utf8");
  it("drops the four legacy columns after the functions stopped naming them", () => {
    for (const col of ["bedtime_enabled", "bedtime_start", "bedtime_end", "school_mode_enabled"]) {
      expect(sql).toContain(`drop column ${col}`);
      expect(contract).not.toContain(col);
      expect(idx).not.toContain(col);
    }
    expect(sql.indexOf("drop function public.device_get_config(uuid)")).toBeLessThan(sql.indexOf("drop column bedtime_enabled"));
    expect(sql.indexOf("device_rules_config_changed()")).toBeLessThan(sql.indexOf("drop column bedtime_enabled"));
  });
  it("the recreated device_get_config returns exactly the wire keys, is read-only and service_role only", () => {
    const fn = sql.slice(sql.indexOf("create function public.device_get_config"));
    for (const col of ["o_config_version", "o_daily_limit_minutes", "o_daily_limit_overrides", "o_app_rules", "o_timezone", "o_schedules"]) {
      expect(fn).toContain(col);
    }
    expect(fn).not.toMatch(/o_bedtime|o_school_mode/);
    expect(fn).not.toMatch(/\b(update|insert|delete)\b\s/i);
    expect(sql).toMatch(/grant execute on function public\.device_get_config\(uuid\) to service_role;/);
    expect(sql).toMatch(/revoke all on function public\.device_get_config\(uuid\) from public, anon, authenticated;/);
  });
  it("the version tuple and the audit field list no longer contain the legacy columns", () => {
    const triggers = sql.slice(sql.indexOf("create or replace function public.device_rules_bump_config_version"), sql.indexOf("drop function public.device_get_config"));
    expect(triggers).not.toMatch(/bedtime|school_mode/);
    expect(triggers).toContain("new.timezone, new.schedules_revision");
  });
});
