import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, type NotificationType } from "@familysafe/contracts";
import { asPreference, PREFERENCE_COLUMNS, PREFERENCE_LABEL, preferenceRows } from "./preferences";

describe("asPreference", () => {
  it("maps a good row", () => expect(asPreference({ type: "BATTERY_LOW", enabled: false })).toEqual(["BATTERY_LOW", false]));
  it("skips unusable rows", () => {
    for (const bad of [null, "x", {}, { type: "LOGIN", enabled: true }, { type: "BATTERY_LOW" }, { type: "BATTERY_LOW", enabled: "no" }, { type: 5, enabled: true }]) {
      expect(asPreference(bad)).toBeNull();
    }
  });
  it("reads exactly the two columns", () => expect(PREFERENCE_COLUMNS).toBe("type,enabled"));
});

describe("preferenceRows", () => {
  it("lists every contract type in order with a title and a description", () => {
    const rows = preferenceRows(new Map());
    expect(rows.map((r) => r.type)).toEqual([...NOTIFICATION_TYPES]);
    for (const r of rows) {
      expect(r.title).toBe(PREFERENCE_LABEL[r.type].title);
      expect(r.description.length).toBeGreaterThan(10);
    }
  });
  it("a type that was never stored is on", () => {
    expect(preferenceRows(new Map()).every((r) => r.enabled)).toBe(true);
  });
  it("a stored off is honoured, except for the always-on types", () => {
    const stored = new Map<NotificationType, boolean>([["BATTERY_LOW", false], ["EMERGENCY", false], ["SECURITY_EVENT", false]]);
    const byType = new Map(preferenceRows(stored).map((r) => [r.type, r]));
    expect(byType.get("BATTERY_LOW")).toMatchObject({ enabled: false, alwaysOn: false });
    expect(byType.get("EMERGENCY")).toMatchObject({ enabled: true, alwaysOn: true });
    expect(byType.get("SECURITY_EVENT")).toMatchObject({ enabled: true, alwaysOn: true });
  });
  it("copy never promises more than the app does", () => {
    const text = Object.values(PREFERENCE_LABEL).map((l) => `${l.title} ${l.description}`).join(" ");
    expect(text).not.toMatch(/\b(secure|safe|protected|guaranteed)\b|cannot be bypassed|locked out/i);
  });
});
