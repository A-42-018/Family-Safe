// Pure display rules for the "Device information" card (Phase 13c). No data access, no React.
// Values come from the device-info upload (API level, security patch, data-partition storage); null = not reported.
import { DEVICE_INFO_INTERVAL_SECONDS, isSecurityPatchDate, SDK_LEVEL_MAX, SDK_LEVEL_MIN, STORAGE_MB_MAX } from "@familysafe/contracts";
import { secondsSince } from "@/lib/devices/status";

export interface DeviceInfoInput {
  sdkLevel: number | null;
  securityPatch: string | null;
  storageTotalMb: number | null;
  storageFreeMb: number | null;
  infoUpdatedAt: string | null;
}

/** Info counts as out of date after three missed daily uploads. */
export const INFO_STALE_SECONDS = DEVICE_INFO_INTERVAL_SECONDS * 3;
export const PATCH_AGING_DAYS = 90;
export const PATCH_OUTDATED_DAYS = 180;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** True once the device has uploaded at least once (a valid `info_updated_at`). */
export function hasReportedInfo(d: Pick<DeviceInfoInput, "infoUpdatedAt">): boolean {
  return d.infoUpdatedAt !== null && !Number.isNaN(Date.parse(d.infoUpdatedAt));
}

/** "Not reported yet" | "Updated 3 hours ago" (relative text shared with "last seen"). */
export function infoUpdatedText(d: Pick<DeviceInfoInput, "infoUpdatedAt">, now: Date, relative: (iso: string | null, now: Date) => string): string {
  return hasReportedInfo(d) ? `Updated ${relative(d.infoUpdatedAt, now).toLowerCase()}` : "Not reported yet";
}

/** Reported values may lag when the last upload is older than three intervals. */
export function isInfoStale(d: Pick<DeviceInfoInput, "infoUpdatedAt">, now: Date): boolean {
  const age = secondsSince(d.infoUpdatedAt, now);
  return age !== null && age > INFO_STALE_SECONDS;
}

/** "API level 35"; out-of-range or missing → null (never invented). */
export function apiLevelText(sdk: number | null): string | null {
  return typeof sdk === "number" && Number.isInteger(sdk) && sdk >= SDK_LEVEL_MIN && sdk <= SDK_LEVEL_MAX ? `API level ${sdk}` : null;
}

/** "5 September 2026" from a real YYYY-MM-DD; anything else → null. */
export function formatPatchDate(iso: string | null): string | null {
  if (iso === null || !isSecurityPatchDate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export type PatchLevel = "recent" | "aging" | "outdated";
export interface PatchHint {
  days: number;
  level: PatchLevel;
  text: string;
}

/** Whole days between the patch date and today (UTC); a future date counts as 0. Null for a missing/invalid date. */
export function patchAgeDays(iso: string | null, now: Date): number | null {
  if (iso === null || !isSecurityPatchDate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(y, m - 1, d)) / 86_400_000);
  return Math.max(0, days);
}

export function patchHint(iso: string | null, now: Date): PatchHint | null {
  const days = patchAgeDays(iso, now);
  if (days === null) return null;
  if (days <= PATCH_AGING_DAYS) return { days, level: "recent", text: "Security patch is recent." };
  const months = Math.floor(days / 30);
  if (days <= PATCH_OUTDATED_DAYS) return { days, level: "aging", text: `Security patch is about ${months} months old. Check for a system update soon.` };
  return { days, level: "outdated", text: `Security patch is over ${months} months old. Check for a system update.` };
}

/** "512 MB" below 1 GB, else "12.3 GB" (1 GB = 1024 MB, as reported by the device). Invalid → null. */
export function formatStorageMb(mb: number | null): string | null {
  if (typeof mb !== "number" || !Number.isFinite(mb) || mb < 0 || mb > STORAGE_MB_MAX) return null;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
}

export interface StorageSummary {
  usedPercent: number; // 0–100, whole number
  usedText: string;
  freeText: string;
  totalText: string;
}

/** Only a consistent pair (total ≥ 1, 0 ≤ free ≤ total) produces a summary; anything else is "unknown". */
export function storageSummary(d: Pick<DeviceInfoInput, "storageTotalMb" | "storageFreeMb">): StorageSummary | null {
  const { storageTotalMb: total, storageFreeMb: free } = d;
  if (typeof total !== "number" || typeof free !== "number") return null;
  if (!Number.isFinite(total) || !Number.isFinite(free) || total < 1 || free < 0 || free > total) return null;
  const used = total - free;
  const usedText = formatStorageMb(used);
  const freeText = formatStorageMb(free);
  const totalText = formatStorageMb(total);
  if (usedText === null || freeText === null || totalText === null) return null;
  return { usedPercent: Math.min(100, Math.max(0, Math.round((used / total) * 100))), usedText, freeText, totalText };
}
