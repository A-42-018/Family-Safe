// Pure display helpers for devices.
import { deviceState, STATE_LABEL, type StatusInput } from "@/lib/devices/status";
import type { DeviceRow } from "./queries";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function deviceStatusBadge(d: StatusInput, now: Date = new Date()): { label: string; variant: BadgeVariant } {
  const state = deviceState(d, now); // read-time stale rule lives in lib/devices/status.ts
  const variant: Record<typeof state, BadgeVariant> = { revoked: "destructive", pending: "outline", online: "default", offline: "secondary", waiting: "secondary" };
  return { label: STATE_LABEL[state], variant: variant[state] };
}

/** "Google Pixel 8 · Android 15", tolerating missing parts; never empty. */
export function deviceSubtitle(d: Pick<DeviceRow, "manufacturer" | "model" | "androidVersion">): string {
  const hw = [d.manufacturer, d.model].filter((x): x is string => !!x && x.trim() !== "").join(" ");
  const os = d.androidVersion ? `Android ${d.androidVersion}` : "";
  return [hw, os].filter(Boolean).join(" · ") || "Android device";
}

export function formatLastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Not seen yet";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Not seen yet";
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

export function deviceListSummary(devices: Pick<DeviceRow, "enrollmentStatus">[]): string {
  const active = devices.filter((d) => d.enrollmentStatus !== "REVOKED").length;
  return active === 0 ? "No active devices" : active === 1 ? "1 active device" : `${active} active devices`;
}
