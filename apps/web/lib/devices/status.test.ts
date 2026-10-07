import { HEARTBEAT_STALE_SECONDS } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import { batteryText, deviceState, isLowBattery, networkText, secondsSince, summarizeDevices, type StatusInput } from "./status";

const NOW = new Date("2026-09-30T12:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const dev = (o: Partial<StatusInput> = {}): StatusInput => ({ enrollmentStatus: "ENROLLED", deviceStatus: "ONLINE", lastSeenAt: ago(60), ...o });

describe("deviceState", () => {
  it("uses the contracts stale constant (2700 s)", () => expect(HEARTBEAT_STALE_SECONDS).toBe(2700));
  it("online when ONLINE and within the window", () => expect(deviceState(dev(), NOW)).toBe("online"));
  it("boundary: exactly 2700 s is still online, 2701 s is offline", () => {
    expect(deviceState(dev({ lastSeenAt: ago(HEARTBEAT_STALE_SECONDS) }), NOW)).toBe("online");
    expect(deviceState(dev({ lastSeenAt: ago(HEARTBEAT_STALE_SECONDS + 1) }), NOW)).toBe("offline");
  });
  it("stored ONLINE but stale → offline (read-time rule beats an unswept row)", () => {
    expect(deviceState(dev({ lastSeenAt: ago(3 * 3600) }), NOW)).toBe("offline");
  });
  it("stored OFFLINE or UNKNOWN with a fresh timestamp is not online", () => {
    expect(deviceState(dev({ deviceStatus: "OFFLINE" }), NOW)).toBe("offline");
    expect(deviceState(dev({ deviceStatus: "UNKNOWN" }), NOW)).toBe("offline");
  });
  it("never seen / unparsable timestamp → waiting", () => {
    expect(deviceState(dev({ lastSeenAt: null, deviceStatus: "UNKNOWN" }), NOW)).toBe("waiting");
    expect(deviceState(dev({ lastSeenAt: "garbage" }), NOW)).toBe("waiting");
  });
  it("future last_seen_at (clock skew) counts as just now", () => {
    expect(secondsSince(new Date(NOW.getTime() + 600_000).toISOString(), NOW)).toBe(0);
    expect(deviceState(dev({ lastSeenAt: new Date(NOW.getTime() + 600_000).toISOString() }), NOW)).toBe("online");
  });
  it("REVOKED and PENDING win over every heartbeat column", () => {
    expect(deviceState(dev({ enrollmentStatus: "REVOKED" }), NOW)).toBe("revoked");
    expect(deviceState(dev({ enrollmentStatus: "PENDING", lastSeenAt: null }), NOW)).toBe("pending");
  });
});

describe("battery and network text", () => {
  it.each([
    [{ batteryLevel: 82, isCharging: false }, "82%", false],
    [{ batteryLevel: 82, isCharging: true }, "82% · charging", false],
    [{ batteryLevel: 15, isCharging: false }, "15%", true],
    [{ batteryLevel: 15, isCharging: true }, "15% · charging", false],
    [{ batteryLevel: 16, isCharging: false }, "16%", false],
    [{ batteryLevel: 0, isCharging: null }, "0%", true],
    [{ batteryLevel: null, isCharging: null }, "Unknown", false],
    [{ batteryLevel: 140, isCharging: false }, "Unknown", false],
    [{ batteryLevel: Number.NaN, isCharging: false }, "Unknown", false],
  ])("%j → %s (low: %s)", (b, text, low) => {
    expect(batteryText(b)).toBe(text);
    expect(isLowBattery(b)).toBe(low);
  });
  it("network labels, unknown values fall back safely", () => {
    expect(networkText("WIFI")).toBe("Wi-Fi");
    expect(networkText("CELLULAR")).toBe("Mobile data");
    expect(networkText("NONE")).toBe("No connection");
    expect(networkText(null)).toBe("Unknown");
    expect(networkText("__proto__")).toBe("Unknown");
    expect(networkText("SATELLITE")).toBe("Unknown");
  });
});

describe("summarizeDevices", () => {
  const b = (level: number | null) => ({ batteryLevel: level, isCharging: false });
  it("counts states, skips revoked/pending, takes the lowest known battery", () => {
    const s = summarizeDevices(
      [
        { ...dev(), ...b(80) },
        { ...dev({ lastSeenAt: ago(9000) }), ...b(30) },
        { ...dev({ lastSeenAt: null, deviceStatus: "UNKNOWN" }), ...b(null) },
        { ...dev({ enrollmentStatus: "REVOKED" }), ...b(1) },
        { ...dev({ enrollmentStatus: "PENDING", lastSeenAt: null }), ...b(2) },
      ],
      NOW,
    );
    expect(s).toEqual({ online: 1, offline: 1, waiting: 1, active: 3, lowestBattery: 30 });
  });
  it("empty → zeros and no battery", () => {
    expect(summarizeDevices([], NOW)).toEqual({ online: 0, offline: 0, waiting: 0, active: 0, lowestBattery: null });
  });
});
