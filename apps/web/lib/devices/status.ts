// Pure status rules for the parent dashboard (Phase 12c). No data access, no React.
// One rule decides "online": device_status = ONLINE **and** last_seen_at within HEARTBEAT_STALE_SECONDS (read-time),
// so a device that stopped beating shows offline even before the DB sweep runs.
import { HEARTBEAT_STALE_SECONDS, type NetworkType } from "@familysafe/contracts";

export const LOW_BATTERY_PERCENT = 15; // mirrors device_heartbeat (BATTERY_LOW: <= 15 and not charging)

export type EnrollmentStatus = "PENDING" | "ENROLLED" | "REVOKED";
export type StoredDeviceStatus = "ONLINE" | "OFFLINE" | "UNKNOWN";
export type DeviceState = "revoked" | "pending" | "waiting" | "online" | "offline";

export interface StatusInput {
  enrollmentStatus: EnrollmentStatus;
  deviceStatus: StoredDeviceStatus;
  lastSeenAt: string | null;
}
export interface BatteryInput {
  batteryLevel: number | null;
  isCharging: boolean | null;
}

/** Seconds since `iso`, clamped at 0 (a future timestamp = clock skew, treated as "just now"); null if unusable. */
export function secondsSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 1000));
}

export function deviceState(d: StatusInput, now: Date = new Date()): DeviceState {
  if (d.enrollmentStatus === "REVOKED") return "revoked"; // revoked / pending always win over heartbeat columns
  if (d.enrollmentStatus === "PENDING") return "pending";
  const age = secondsSince(d.lastSeenAt, now);
  if (age === null) return "waiting";
  return d.deviceStatus === "ONLINE" && age <= HEARTBEAT_STALE_SECONDS ? "online" : "offline";
}

export const STATE_LABEL: Record<DeviceState, string> = {
  revoked: "Access revoked",
  pending: "Pending",
  waiting: "Waiting for first check-in",
  online: "Online",
  offline: "Offline",
};

function validLevel(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
}

export function isLowBattery(b: BatteryInput): boolean {
  return validLevel(b.batteryLevel) && b.batteryLevel <= LOW_BATTERY_PERCENT && b.isCharging !== true;
}

/** "82%", "82% · charging", "Unknown" (never a made-up number). */
export function batteryText(b: BatteryInput): string {
  if (!validLevel(b.batteryLevel)) return "Unknown";
  return b.isCharging ? `${Math.round(b.batteryLevel)}% · charging` : `${Math.round(b.batteryLevel)}%`;
}

const NETWORK_LABEL: Record<NetworkType, string> = {
  WIFI: "Wi-Fi", CELLULAR: "Mobile data", ETHERNET: "Ethernet", VPN: "VPN", NONE: "No connection", UNKNOWN: "Unknown",
};
export function networkText(t: string | null): string {
  return t !== null && Object.prototype.hasOwnProperty.call(NETWORK_LABEL, t) ? NETWORK_LABEL[t as NetworkType] : "Unknown";
}

export interface DeviceSummary {
  online: number;
  offline: number;
  waiting: number;
  active: number;
  /** Lowest known battery among active (non-revoked, non-pending) devices; null if none reported. */
  lowestBattery: number | null;
}

export function summarizeDevices(devices: (StatusInput & BatteryInput)[], now: Date = new Date()): DeviceSummary {
  const s: DeviceSummary = { online: 0, offline: 0, waiting: 0, active: 0, lowestBattery: null };
  for (const d of devices) {
    const st = deviceState(d, now);
    if (st === "revoked" || st === "pending") continue;
    s.active += 1;
    if (st === "online") s.online += 1;
    else if (st === "offline") s.offline += 1;
    else s.waiting += 1;
    if (validLevel(d.batteryLevel) && (s.lowestBattery === null || d.batteryLevel < s.lowestBattery)) s.lowestBattery = d.batteryLevel;
  }
  return s;
}
