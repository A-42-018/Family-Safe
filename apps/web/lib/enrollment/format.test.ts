import { describe, expect, it } from "vitest";
import { deviceListSummary, deviceStatusBadge, deviceSubtitle, formatLastSeen } from "./format";

const NOW = new Date("2026-09-29T12:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

describe("deviceStatusBadge", () => {
  it.each([
    [{ enrollmentStatus: "REVOKED", deviceStatus: "ONLINE", lastSeenAt: ago(10) }, "Access revoked", "destructive"],
    [{ enrollmentStatus: "PENDING", deviceStatus: "UNKNOWN", lastSeenAt: null }, "Pending", "outline"],
    [{ enrollmentStatus: "ENROLLED", deviceStatus: "ONLINE", lastSeenAt: ago(10) }, "Online", "default"],
    [{ enrollmentStatus: "ENROLLED", deviceStatus: "ONLINE", lastSeenAt: ago(2701) }, "Offline", "secondary"], // stale rule
    [{ enrollmentStatus: "ENROLLED", deviceStatus: "OFFLINE", lastSeenAt: ago(10) }, "Offline", "secondary"],
    [{ enrollmentStatus: "ENROLLED", deviceStatus: "UNKNOWN", lastSeenAt: null }, "Waiting for first check-in", "secondary"],
  ] as const)("%j", (d, label, variant) => expect(deviceStatusBadge(d, NOW)).toEqual({ label, variant }));
});

describe("deviceSubtitle", () => {
  it("joins hardware and OS, tolerating gaps", () => {
    expect(deviceSubtitle({ manufacturer: "Google", model: "Pixel 8", androidVersion: "15" })).toBe("Google Pixel 8 · Android 15");
    expect(deviceSubtitle({ manufacturer: null, model: "Pixel 8", androidVersion: null })).toBe("Pixel 8");
    expect(deviceSubtitle({ manufacturer: "  ", model: null, androidVersion: "14" })).toBe("Android 14");
    expect(deviceSubtitle({ manufacturer: null, model: null, androidVersion: null })).toBe("Android device");
  });
});

describe("formatLastSeen", () => {
  it.each([
    [null, "Not seen yet"], ["garbage", "Not seen yet"], [ago(5), "Just now"], [ago(60), "1 minute ago"], [ago(600), "10 minutes ago"],
    [ago(3600), "1 hour ago"], [ago(7200), "2 hours ago"], [ago(86400), "1 day ago"], [ago(86400 * 3), "3 days ago"],
    [new Date(NOW.getTime() + 60_000).toISOString(), "Just now"], // clock skew never yields negative durations
  ])("%s → %s", (iso, out) => expect(formatLastSeen(iso, NOW)).toBe(out));
});

describe("deviceListSummary", () => {
  it("counts only non-revoked devices", () => {
    expect(deviceListSummary([])).toBe("No active devices");
    expect(deviceListSummary([{ enrollmentStatus: "REVOKED" }])).toBe("No active devices");
    expect(deviceListSummary([{ enrollmentStatus: "ENROLLED" }, { enrollmentStatus: "REVOKED" }])).toBe("1 active device");
    expect(deviceListSummary([{ enrollmentStatus: "ENROLLED" }, { enrollmentStatus: "PENDING" }])).toBe("2 active devices");
  });
});
