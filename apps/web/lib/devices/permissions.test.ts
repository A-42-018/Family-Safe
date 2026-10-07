import { PERMISSION_KEYS, PERMISSION_STATES, PERMISSION_SYNC_INTERVAL_SECONDS, type PermissionKey, type PermissionState } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import { formatLastSeen } from "@/lib/enrollment/format";
import {
  arePermissionsStale,
  asPermissionState,
  hasVerifiedPermissions,
  PERMISSION_COLUMNS,
  PERMISSION_LABEL,
  PERMISSION_PURPOSE,
  PERMISSION_STATE_COPY,
  PERMISSIONS_STALE_SECONDS,
  permissionRows,
  permissionsUpdatedText,
  revokedLabels,
  revokedNotice,
  type PermissionsInput,
} from "./permissions";

const NOW = new Date("2026-10-01T12:00:00Z");
const all = (s: PermissionState | null): PermissionsInput["states"] => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, s])) as PermissionsInput["states"];
const input = (over: Partial<PermissionsInput["states"]> = {}, at: string | null = "2026-10-01T11:00:00Z"): PermissionsInput => ({ states: { ...all("NOT_REQUESTED"), ...over }, lastVerifiedAt: at });

describe("catalog", () => {
  it("columns are exactly the contract catalog plus last_verified_at", () => {
    expect(PERMISSION_COLUMNS.split(",")).toEqual([...PERMISSION_KEYS.map((k) => `${k}_status`), "last_verified_at"]);
    expect(PERMISSION_COLUMNS).not.toMatch(/fcm|token|credential|hash|refresh/i);
  });
  it("every key has a label and purpose; every state has copy", () => {
    for (const k of PERMISSION_KEYS) {
      expect(PERMISSION_LABEL[k].length).toBeGreaterThan(0);
      expect(PERMISSION_PURPOSE[k].length).toBeGreaterThan(0);
    }
    for (const s of PERMISSION_STATES) {
      expect(PERMISSION_STATE_COPY[s].label.length).toBeGreaterThan(0);
      expect(PERMISSION_STATE_COPY[s].text.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PERMISSION_STATE_COPY).sort()).toEqual([...PERMISSION_STATES].sort());
  });
  it("wording is informational: never claims the device is secure, safe or protected", () => {
    const words = [...Object.values(PERMISSION_STATE_COPY).flatMap((c) => [c.label, c.text]), ...Object.values(PERMISSION_PURPOSE)].join(" ");
    expect(words).not.toMatch(/\b(secure|safe|protected|guaranteed|verified safe)\b/i);
  });
  it("SMS / call history wording matches the Play-restriction message", () => {
    expect(PERMISSION_STATE_COPY.NOT_AVAILABLE.text).toBe("Feature unavailable under current Android/Play distribution requirements.");
    expect(PERMISSION_PURPOSE.sms).toMatch(/restricted/i);
    expect(PERMISSION_PURPOSE.call_log).toMatch(/restricted/i);
  });
});

describe("asPermissionState", () => {
  it("accepts only the CHECK-listed states", () => {
    for (const s of PERMISSION_STATES) expect(asPermissionState(s)).toBe(s);
    for (const bad of ["granted", "", "GRANTED ", "toString", "__proto__", null, undefined, 1, {}, []]) expect(asPermissionState(bad)).toBeNull();
  });
});

describe("verification time", () => {
  it("not reported until last_verified_at parses", () => {
    for (const at of [null, "", "nonsense"]) {
      expect(hasVerifiedPermissions({ lastVerifiedAt: at })).toBe(false);
      expect(permissionsUpdatedText({ lastVerifiedAt: at }, NOW, formatLastSeen)).toBe("Not reported yet");
    }
    expect(hasVerifiedPermissions({ lastVerifiedAt: "2026-10-01T11:00:00Z" })).toBe(true);
  });
  it("reuses the relative text of 'last seen'", () => {
    expect(permissionsUpdatedText({ lastVerifiedAt: "2026-10-01T09:00:00Z" }, NOW, formatLastSeen)).toBe("Updated 3 hours ago");
    expect(permissionsUpdatedText({ lastVerifiedAt: "2026-10-01T11:59:30Z" }, NOW, formatLastSeen)).toBe("Updated just now");
  });
  it("stale after three sync intervals (boundary), never for missing or future times", () => {
    expect(PERMISSIONS_STALE_SECONDS).toBe(PERMISSION_SYNC_INTERVAL_SECONDS * 3);
    const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
    expect(arePermissionsStale({ lastVerifiedAt: at(PERMISSIONS_STALE_SECONDS) }, NOW)).toBe(false);
    expect(arePermissionsStale({ lastVerifiedAt: at(PERMISSIONS_STALE_SECONDS + 1) }, NOW)).toBe(true);
    expect(arePermissionsStale({ lastVerifiedAt: null }, NOW)).toBe(false);
    expect(arePermissionsStale({ lastVerifiedAt: "2026-10-02T00:00:00Z" }, NOW)).toBe(false);
  });
});

describe("permissionRows", () => {
  it("one row per catalog permission, in contract order", () => {
    expect(permissionRows(input()).map((r) => r.key)).toEqual([...PERMISSION_KEYS]);
  });
  it("shows every state with its label and variant", () => {
    const states: Record<PermissionKey, PermissionState> = {
      camera: "GRANTED", microphone: "DENIED", contacts: "REVOKED", sms: "NOT_AVAILABLE", call_log: "NOT_AVAILABLE",
      location: "RESTRICTED", precise_location: "NOT_REQUESTED", background_location: "GRANTED",
    };
    const rows = permissionRows({ states, lastVerifiedAt: "2026-10-01T11:00:00Z" });
    for (const r of rows) {
      const s = states[r.key];
      expect(r.state).toBe(s);
      expect(r.stateLabel).toBe(PERMISSION_STATE_COPY[s].label);
      expect(r.stateText).toBe(PERMISSION_STATE_COPY[s].text);
      expect(r.variant).toBe(PERMISSION_STATE_COPY[s].variant);
    }
    expect(rows.filter((r) => r.revoked).map((r) => r.key)).toEqual(["contacts"]);
  });
  it("claims no state before the first verification, even if the stored defaults say NOT_REQUESTED/REVOKED", () => {
    const rows = permissionRows({ states: all("REVOKED"), lastVerifiedAt: null });
    for (const r of rows) {
      expect(r.state).toBeNull();
      expect(r.stateLabel).toBe("Not reported yet");
      expect(r.revoked).toBe(false);
    }
    expect(revokedLabels({ states: all("REVOKED"), lastVerifiedAt: null })).toEqual([]);
  });
  it("an unrecognised value is 'Unknown', never a made-up state", () => {
    const rows = permissionRows(input({ camera: null }));
    const cam = rows.find((r) => r.key === "camera")!;
    expect(cam).toMatchObject({ state: null, stateLabel: "Unknown", revoked: false });
  });
});

describe("revoked notice", () => {
  it("null when nothing was turned off", () => {
    expect(revokedNotice(input())).toBeNull();
    expect(revokedNotice(input({ camera: "DENIED", microphone: "GRANTED" }))).toBeNull();
  });
  it("names one permission or counts several, in catalog order", () => {
    expect(revokedNotice(input({ location: "REVOKED" }))).toBe("Approximate location was turned off on the device.");
    expect(revokedNotice(input({ microphone: "REVOKED", camera: "REVOKED" }))).toBe("2 permissions were turned off on the device: Camera, Microphone.");
  });
  it("only REVOKED counts (DENIED and RESTRICTED do not raise the badge)", () => {
    expect(revokedLabels(input({ camera: "DENIED", microphone: "RESTRICTED" }))).toEqual([]);
  });
});
