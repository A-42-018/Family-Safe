import { describe, expect, it } from "vitest";
import {
  ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT, activitySummary, asActivityEvent, describeEvent, humanizeType, nextLimit, packagesIn, parseLimit,
  type ActivityEvent,
} from "./activity";

const ev = (type: string, metadata: Record<string, unknown> = {}): ActivityEvent => ({ id: `id-${type}`, type, at: "2026-10-01T09:00:00Z", metadata });
const labels = new Map([["com.video.app", "Video"]]);
const labelFor = (p: string) => labels.get(p) ?? null;

describe("parseLimit", () => {
  it("defaults, clamps and ignores junk", () => {
    expect(parseLimit({})).toBe(ACTIVITY_DEFAULT_LIMIT);
    expect(parseLimit({ limit: "100" })).toBe(100);
    expect(parseLimit({ limit: ["80", "90"] })).toBe(80);
    expect(parseLimit({ limit: "5" })).toBe(10);
    expect(parseLimit({ limit: "9999" })).toBe(ACTIVITY_MAX_LIMIT);
    for (const bad of ["", "abc", "-5", "1.5", "1e3", "00000001", " 50", "50 "]) expect(parseLimit({ limit: bad })).toBe(ACTIVITY_DEFAULT_LIMIT);
  });
  it("nextLimit grows by a step and stops at the maximum", () => {
    expect(nextLimit(50)).toBe(100);
    expect(nextLimit(180)).toBe(ACTIVITY_MAX_LIMIT);
    expect(nextLimit(ACTIVITY_MAX_LIMIT)).toBeNull();
  });
});

describe("asActivityEvent", () => {
  const raw = { id: "e1", event_type: "DEVICE_ONLINE", metadata: {}, created_at: "2026-10-01T09:00:00Z" };
  it("accepts a good row", () => expect(asActivityEvent(raw)).toEqual({ id: "e1", type: "DEVICE_ONLINE", at: "2026-10-01T09:00:00Z", metadata: {} }));
  it("turns unusable metadata into an empty object", () => {
    expect(asActivityEvent({ ...raw, metadata: null })?.metadata).toEqual({});
    expect(asActivityEvent({ ...raw, metadata: [1] })?.metadata).toEqual({});
  });
  it("skips unusable rows", () => {
    for (const bad of [null, "x", 5, {}, { ...raw, id: "" }, { ...raw, id: 3 }, { ...raw, event_type: "lower" }, { ...raw, event_type: "A" }, { ...raw, created_at: "yesterday" }, { ...raw, created_at: null }]) {
      expect(asActivityEvent(bad)).toBeNull();
    }
  });
});

describe("describeEvent", () => {
  it("online / offline / battery", () => {
    expect(describeEvent(ev("DEVICE_ONLINE"), labelFor)).toMatchObject({ title: "Device came online", tone: "neutral", detail: null });
    expect(describeEvent(ev("DEVICE_OFFLINE"), labelFor)).toMatchObject({ title: "Device went offline", tone: "warning" });
    expect(describeEvent(ev("BATTERY_LOW"), labelFor)).toMatchObject({ title: "Battery is low", tone: "warning" });
  });
  it("permission changes use readable names and flag a turned-off permission", () => {
    const off = describeEvent(ev("PERMISSION_STATE_CHANGED", { permission: "precise_location", from: "GRANTED", to: "REVOKED" }), labelFor);
    expect(off).toMatchObject({ title: "A permission changed", detail: "Precise location: allowed → turned off", tone: "warning" });
    const on = describeEvent(ev("PERMISSION_STATE_CHANGED", { permission: "camera", from: "NOT_REQUESTED", to: "GRANTED" }), labelFor);
    expect(on).toMatchObject({ detail: "Camera: not asked yet → allowed", tone: "neutral" });
  });
  it("unknown permission or state values never leak raw text", () => {
    const d = describeEvent(ev("PERMISSION_STATE_CHANGED", { permission: "<script>", from: "NOPE", to: 5 }), labelFor);
    expect(d.detail).toBe("A permission: unknown → unknown");
    expect(JSON.stringify(d)).not.toContain("script");
  });
  it("app events name the app by label, fall back to the package, and handle counts", () => {
    expect(describeEvent(ev("APP_INSTALLED", { package_name: "com.video.app" }), labelFor)).toMatchObject({ title: "App installed", detail: "Video" });
    expect(describeEvent(ev("APP_UNINSTALLED", { package_name: "com.other.app" }), labelFor)).toMatchObject({ title: "App removed", detail: "com.other.app" });
    expect(describeEvent(ev("APP_INSTALLED", { count: 12 }), labelFor)).toMatchObject({ title: "12 apps installed", detail: null });
    expect(describeEvent(ev("APP_INSTALLED", {}), labelFor)).toMatchObject({ title: "App installed", detail: null });
    expect(describeEvent(ev("APP_INSTALLED", { count: -1 }), labelFor)).toMatchObject({ title: "App installed" });
  });
  it("a blocked app attempt names the app and is a warning", () => {
    expect(describeEvent(ev("BLOCKED_APP_ATTEMPT", { package_name: "com.video.app", occurred_at: "2026-10-01T08:59:00.000Z" }), labelFor)).toMatchObject({
      title: "A blocked app was opened", detail: "Video", tone: "warning",
    });
  });
  it("unknown types get a readable title and never print metadata", () => {
    const d = describeEvent(ev("RULE_UPDATED", { secret: "do-not-show" }), labelFor);
    expect(d).toMatchObject({ title: "Rule updated", detail: null });
    expect(JSON.stringify(d)).not.toContain("do-not-show");
    expect(humanizeType("GEOFENCE_ENTER")).toBe("Geofence enter");
  });
  it("oversized or non-string package values are ignored", () => {
    expect(describeEvent(ev("BLOCKED_APP_ATTEMPT", { package_name: "x".repeat(300) }), labelFor).detail).toBeNull();
    expect(describeEvent(ev("BLOCKED_APP_ATTEMPT", { package_name: 5 }), labelFor).detail).toBeNull();
  });
});

describe("packagesIn / activitySummary", () => {
  it("collects each named package once", () => {
    expect(packagesIn([ev("APP_INSTALLED", { package_name: "a.b.c" }), ev("BLOCKED_APP_ATTEMPT", { package_name: "a.b.c" }), ev("BATTERY_LOW"), ev("APP_INSTALLED", { package_name: "d.e.f" })]).sort()).toEqual(["a.b.c", "d.e.f"]);
  });
  it("summary says plainly what is shown", () => {
    expect(activitySummary(0, false)).toBe("Nothing has been reported yet.");
    expect(activitySummary(1, false)).toBe("Showing 1 event.");
    expect(activitySummary(7, false)).toBe("Showing all 7 events.");
    expect(activitySummary(50, true)).toBe("Showing the latest 50 events.");
  });
});
