import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@familysafe/contracts";
import {
  alertsHint, alertsValue, asNotificationRow, describeNotification, nextNotificationsLimit, notificationsSummary, NOTIFICATIONS_MAX_LIMIT,
  parseNotificationsLimit, unreadBadge, type NotificationRow,
} from "./notifications";

const raw = (over: Record<string, unknown> = {}) => ({ id: "n1", type: "BATTERY_LOW", metadata: {}, created_at: "2026-10-01T09:00:00Z", read_at: null, devices: { device_name: "Phone" }, ...over });
const row = (type: NotificationRow["type"], metadata: Record<string, unknown> = {}, deviceName: string | null = "Phone", readAt: string | null = null): NotificationRow => ({
  id: "n1", type, deviceName, metadata, at: "2026-10-01T09:00:00Z", readAt,
});

describe("asNotificationRow", () => {
  it("maps a good row and reads the device name from an object or an array", () => {
    expect(asNotificationRow(raw())).toEqual({ id: "n1", type: "BATTERY_LOW", deviceName: "Phone", metadata: {}, at: "2026-10-01T09:00:00Z", readAt: null });
    expect(asNotificationRow(raw({ devices: [{ device_name: "Tab" }] }))?.deviceName).toBe("Tab");
    expect(asNotificationRow(raw({ devices: null }))?.deviceName).toBeNull();
    expect(asNotificationRow(raw({ devices: { device_name: "" } }))?.deviceName).toBeNull();
  });
  it("keeps a valid read time and drops a bad one", () => {
    expect(asNotificationRow(raw({ read_at: "2026-10-01T10:00:00Z" }))?.readAt).toBe("2026-10-01T10:00:00Z");
    expect(asNotificationRow(raw({ read_at: "soon" }))?.readAt).toBeNull();
  });
  it("turns bad metadata into an empty object", () => {
    expect(asNotificationRow(raw({ metadata: [1] }))?.metadata).toEqual({});
    expect(asNotificationRow(raw({ metadata: null }))?.metadata).toEqual({});
  });
  it("skips unusable rows", () => {
    for (const bad of [null, "x", {}, raw({ id: "" }), raw({ id: 1 }), raw({ type: "LOGIN" }), raw({ type: "battery_low" }), raw({ created_at: "never" }), raw({ created_at: null })]) {
      expect(asNotificationRow(bad)).toBeNull();
    }
  });
  it("accepts every contract type", () => {
    for (const t of NOTIFICATION_TYPES) expect(asNotificationRow(raw({ type: t }))?.type).toBe(t);
  });
});

describe("describeNotification", () => {
  it("every type has a title and a tone", () => {
    for (const t of NOTIFICATION_TYPES) {
      const l = describeNotification(row(t));
      expect(l.title.length).toBeGreaterThan(3);
      expect(["urgent", "warning", "neutral"]).toContain(l.tone);
    }
  });
  it("emergencies and security notices are urgent", () => {
    expect(describeNotification(row("EMERGENCY")).tone).toBe("urgent");
    expect(describeNotification(row("SECURITY_EVENT", { reason: "credential_reuse" })).tone).toBe("urgent");
  });
  it("fills the device name and nothing else from the row", () => {
    expect(describeNotification(row("DEVICE_OFFLINE"))).toMatchObject({ title: "Device offline", detail: "Phone stopped checking in." });
    expect(describeNotification(row("DEVICE_OFFLINE", {}, null)).detail).toBe("A device stopped checking in.");
    expect(describeNotification(row("BATTERY_LOW")).detail).toBe("Phone has a low battery.");
    expect(describeNotification(row("BLOCKED_APP_ATTEMPT", { package_name: "com.secret.app" })).detail).toBe("Phone");
  });
  it("a revoked permission is named from the fixed list; odd keys are dropped", () => {
    expect(describeNotification(row("PERMISSION_REVOKED", { permission: "precise_location" })).detail).toBe("Precise location on Phone.");
    expect(describeNotification(row("PERMISSION_REVOKED", { permission: "<script>" })).detail).toBe("Phone");
    expect(describeNotification(row("PERMISSION_REVOKED", { permission: "camera" }, null)).detail).toBe("Camera.");
  });
  it("a security notice explains a reused credential and nothing from the metadata", () => {
    expect(describeNotification(row("SECURITY_EVENT", { reason: "credential_reuse" })).detail).toMatch(/was removed because its sign-in was used twice/);
    const other = describeNotification(row("SECURITY_EVENT", { reason: "<img onerror=x>" }, null));
    expect(other.detail).toBeNull();
    expect(JSON.stringify(other)).not.toContain("onerror");
  });
  it("tracks unread from the read time", () => {
    expect(describeNotification(row("BATTERY_LOW")).unread).toBe(true);
    expect(describeNotification(row("BATTERY_LOW", {}, "Phone", "2026-10-01T10:00:00Z")).unread).toBe(false);
  });
});

describe("badge, paging and dashboard text", () => {
  it("unreadBadge", () => {
    expect(unreadBadge(null)).toBeNull();
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-3)).toBeNull();
    expect(unreadBadge(NaN)).toBeNull();
    expect(unreadBadge(1)).toBe("1");
    expect(unreadBadge(9)).toBe("9");
    expect(unreadBadge(10)).toBe("9+");
    expect(unreadBadge(500)).toBe("9+");
  });
  it("parseNotificationsLimit clamps and ignores junk", () => {
    expect(parseNotificationsLimit({})).toBe(30);
    expect(parseNotificationsLimit({ limit: "60" })).toBe(60);
    expect(parseNotificationsLimit({ limit: ["90", "30"] })).toBe(90);
    expect(parseNotificationsLimit({ limit: "5" })).toBe(30);
    expect(parseNotificationsLimit({ limit: "9999" })).toBe(NOTIFICATIONS_MAX_LIMIT);
    for (const bad of ["", "x", "-1", "1.5", "1e3", " 60", "99999"]) expect(parseNotificationsLimit({ limit: bad })).toBe(30);
  });
  it("nextNotificationsLimit stops at the maximum", () => {
    expect(nextNotificationsLimit(30)).toBe(60);
    expect(nextNotificationsLimit(140)).toBe(NOTIFICATIONS_MAX_LIMIT);
    expect(nextNotificationsLimit(NOTIFICATIONS_MAX_LIMIT)).toBeNull();
  });
  it("summary and dashboard text say what is known and never claim a zero they could not read", () => {
    expect(notificationsSummary(0, 0, false)).toMatch(/all caught up/);
    expect(notificationsSummary(3, 0, false)).toBe("Nothing unread. Showing all 3.");
    expect(notificationsSummary(30, 1, true)).toBe("1 unread. Showing the latest 30.");
    expect(notificationsSummary(1, 2, false)).toBe("2 unread. Showing 1 notification.");
    expect(alertsValue(null)).toBeUndefined();
    expect(alertsValue(0)).toBe("0");
    expect(alertsHint(null)).toBe("Your notifications could not be read.");
    expect(alertsHint(0)).toBe("Nothing needs your attention.");
    expect(alertsHint(1)).toBe("1 unread notification needs your attention.");
    expect(alertsHint(4)).toBe("4 unread notifications need your attention.");
  });
});
