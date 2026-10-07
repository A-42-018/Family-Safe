import { APP_RULES_MAX, CHILD_APP_PACKAGE, DAILY_LIMIT_MAX_MINUTES } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import type { AppRow } from "@/lib/devices/apps";
import {
  APP_RULE_COLUMNS, APP_RULE_FORM_KEYS, APP_RULES_NOTE, asAppRuleRow, atRuleCap, canRestrict, CHILD_APP_MESSAGE, FIELD, INACTIVE_MESSAGE,
  INVALID_MESSAGE, mergeRestrictions, parseAppRuleForm, restrictionOf, restrictionText, RULES_CAP_NOTE, ruleCounts, ruleSummaryText, savedMessage,
  UNCHANGED_MESSAGE, UNKNOWN_APP_MESSAGE, type AppRuleRow,
} from "./restrictions";

const DEV = "44444444-4444-4444-8444-444444444444";
const app = (packageName: string, over: Partial<AppRow> = {}): AppRow => ({ packageName, label: `App ${packageName}`, versionName: null, isSystem: false, ...over });
const rule = (packageName: string, over: Partial<AppRuleRow> = {}): AppRuleRow => ({ packageName, blocked: false, dailyLimit: 30, ...over });
const form = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ [FIELD.deviceId]: DEV, [FIELD.packageName]: "com.example.game", [FIELD.intent]: "limit", [FIELD.minutes]: "45", ...over });

describe("asAppRuleRow", () => {
  it("accepts blocked rows, limited rows and a 0-minute limit", () => {
    expect(asAppRuleRow({ package_name: "a.b", blocked: true, daily_limit_minutes: null })).toEqual({ packageName: "a.b", blocked: true, dailyLimit: null });
    expect(asAppRuleRow({ package_name: "a.b", blocked: false, daily_limit_minutes: 45 })).toEqual({ packageName: "a.b", blocked: false, dailyLimit: 45 });
    expect(asAppRuleRow({ package_name: "a.b", blocked: false, daily_limit_minutes: 0 })).toEqual({ packageName: "a.b", blocked: false, dailyLimit: 0 });
    expect(asAppRuleRow({ package_name: "a.b", blocked: true, daily_limit_minutes: 20 })).toEqual({ packageName: "a.b", blocked: true, dailyLimit: 20 });
  });
  it("skips unusable rows and rows that restrict nothing", () => {
    for (const bad of [null, undefined, "x", 1, [], {}, { package_name: "", blocked: true, daily_limit_minutes: null }, { package_name: 5, blocked: true, daily_limit_minutes: null },
      { package_name: "a.b", blocked: "yes", daily_limit_minutes: null }, { package_name: "a.b", blocked: false, daily_limit_minutes: null },
      { package_name: "a.b", blocked: false, daily_limit_minutes: -1 }, { package_name: "a.b", blocked: false, daily_limit_minutes: 1.5 },
      { package_name: "a.b", blocked: false, daily_limit_minutes: DAILY_LIMIT_MAX_MINUTES + 1 }, { package_name: "a.b", blocked: false, daily_limit_minutes: "30" },
      { package_name: "a.b", blocked: false }]) expect(asAppRuleRow(bad)).toBeNull();
  });
});

describe("restrictionOf / restrictionText", () => {
  it("blocked wins over a stored limit; no rule or an empty rule is no restriction", () => {
    expect(restrictionOf(undefined)).toEqual({ kind: "none" });
    expect(restrictionOf(rule("a.b", { blocked: true, dailyLimit: 20 }))).toEqual({ kind: "blocked" });
    expect(restrictionOf(rule("a.b", { dailyLimit: 20 }))).toEqual({ kind: "limited", minutes: 20 });
    expect(restrictionOf(rule("a.b", { dailyLimit: null }))).toEqual({ kind: "none" });
  });
  it("texts", () => {
    expect(restrictionText({ kind: "none" })).toBe("No restriction");
    expect(restrictionText({ kind: "blocked" })).toBe("Blocked");
    expect(restrictionText({ kind: "limited", minutes: 90 })).toBe("Limit: 1 h 30 min a day");
    expect(restrictionText({ kind: "limited", minutes: 0 })).toBe("No use allowed (0 min a day)");
  });
  it("the child app can never be restricted", () => {
    expect(canRestrict(CHILD_APP_PACKAGE)).toBe(false);
    expect(canRestrict("com.example.game")).toBe(true);
  });
});

describe("mergeRestrictions", () => {
  it("keeps the inventory, attaches states, and adds rules for apps the device no longer reports", () => {
    const m = mergeRestrictions([app("a.one"), app("a.two")], [rule("a.one", { blocked: true }), rule("gone.app", { dailyLimit: 10 }), rule("a.empty", { dailyLimit: null })]);
    expect(m.apps.map((a) => a.packageName)).toEqual(["a.one", "a.two", "gone.app"]);
    expect(m.apps[2]).toMatchObject({ label: "gone.app", isSystem: false, versionName: null });
    expect(m.states.get("a.one")).toEqual({ kind: "blocked" });
    expect(m.states.get("gone.app")).toEqual({ kind: "limited", minutes: 10 });
    expect(m.states.has("a.two")).toBe(false);
    expect(m.states.has("a.empty")).toBe(false);
    expect(m.unreported).toBe(1);
  });
  it("does not mutate its inputs", () => {
    const apps = [app("a.one")];
    mergeRestrictions(apps, [rule("x.y")]);
    expect(apps).toHaveLength(1);
  });
});

describe("counts and cap", () => {
  it("counts blocked and limited apps", () => {
    const c = ruleCounts([rule("a.a", { blocked: true }), rule("b.b"), rule("c.c", { dailyLimit: 0 }), rule("d.d", { dailyLimit: null })]);
    expect(c).toEqual({ total: 3, blocked: 1, limited: 2 });
    expect(ruleSummaryText(c)).toBe("1 blocked, 2 with a daily limit.");
    expect(ruleSummaryText({ total: 0, blocked: 0, limited: 0 })).toBe("No app is restricted.");
    expect(ruleSummaryText({ total: 2, blocked: 2, limited: 0 })).toBe("2 blocked.");
  });
  it("the cap comes from the contract", () => {
    expect(atRuleCap({ total: APP_RULES_MAX - 1, blocked: 0, limited: 0 })).toBe(false);
    expect(atRuleCap({ total: APP_RULES_MAX, blocked: 0, limited: 0 })).toBe(true);
    expect(RULES_CAP_NOTE).toContain(String(APP_RULES_MAX));
  });
});

describe("parseAppRuleForm", () => {
  it("limit → not blocked with whole minutes", () => {
    const r = parseAppRuleForm(form());
    expect(r).toMatchObject({ ok: true, intent: "limit", input: { device_id: DEV, package_name: "com.example.game", blocked: false, daily_limit_minutes: 45 } });
  });
  it("block → blocked, no limit, and a stray minutes value never leaks", () => {
    const r = parseAppRuleForm(form({ [FIELD.intent]: "block", [FIELD.minutes]: "45" }));
    expect(r).toMatchObject({ ok: true, intent: "block", input: { blocked: true, daily_limit_minutes: null } });
  });
  it("clear → no restriction, and an invalid minutes box is ignored", () => {
    const r = parseAppRuleForm(form({ [FIELD.intent]: "clear", [FIELD.minutes]: "abc" }));
    expect(r).toMatchObject({ ok: true, intent: "clear", input: { blocked: false, daily_limit_minutes: null } });
  });
  it("limit needs whole minutes from 1 to the contract maximum", () => {
    expect(parseAppRuleForm(form({ [FIELD.minutes]: String(DAILY_LIMIT_MAX_MINUTES) }))).toMatchObject({ ok: true });
    for (const bad of ["", " ", "0", "-5", "1.5", "1e2", "+5", "９", "12345", String(DAILY_LIMIT_MAX_MINUTES + 1), "1 5", "abc"]) {
      const r = parseAppRuleForm(form({ [FIELD.minutes]: bad }));
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.fieldErrors[FIELD.minutes]?.[0], bad).toBeTruthy();
        expect(r.values[FIELD.minutes]).toBe(bad);
      }
    }
  });
  it("unknown or missing intent is a form error", () => {
    for (const intent of [undefined, "", "BLOCK", "delete", "__proto__", 5]) {
      expect(parseAppRuleForm(form({ [FIELD.intent]: intent }))).toMatchObject({ ok: false, formError: "Choose an action." });
    }
  });
  it("the child app and malformed package names are refused", () => {
    expect(parseAppRuleForm(form({ [FIELD.packageName]: CHILD_APP_PACKAGE, [FIELD.intent]: "block" }))).toMatchObject({ ok: false, formError: CHILD_APP_MESSAGE });
    for (const pkg of ["", "nodots", "a..b", "1a.b", "a.b c", "a.b;drop", "a".repeat(260) + ".b", undefined]) {
      expect(parseAppRuleForm(form({ [FIELD.packageName]: pkg, [FIELD.intent]: "block" })).ok, String(pkg)).toBe(false);
    }
  });
  it("a bad device id is refused by the contract", () => {
    expect(parseAppRuleForm(form({ [FIELD.deviceId]: "nope" })).ok).toBe(false);
  });
  it("reads only the four known keys", () => {
    expect([...APP_RULE_FORM_KEYS].sort()).toEqual(["device_id", "intent", "minutes", "package_name"]);
    expect(APP_RULE_COLUMNS).toBe("package_name,blocked,daily_limit_minutes");
  });
});

describe("copy", () => {
  const all = [APP_RULES_NOTE, CHILD_APP_MESSAGE, INACTIVE_MESSAGE, INVALID_MESSAGE, UNCHANGED_MESSAGE, UNKNOWN_APP_MESSAGE, savedMessage("block"), savedMessage("limit"), savedMessage("clear"), RULES_CAP_NOTE];
  it("is informational: no safety claims and no promise of a hard lock", () => {
    for (const t of all) {
      expect(t).not.toMatch(/\b(secure|safe|protected)\b/i);
      expect(t).not.toMatch(/guaranteed|cannot be bypassed|unbypassable|locked out|prevents?\b/i);
    }
  });
  it("says plainly that Android does not let the app lock the phone", () => {
    expect(APP_RULES_NOTE).toMatch(/does not let this app close other apps or lock the phone/);
    expect(APP_RULES_NOTE).toMatch(/0\.18\.0/);
    expect(APP_RULES_NOTE).toMatch(/does not show those records yet/);
    expect(APP_RULES_NOTE).not.toMatch(/not available yet/);
  });
});
