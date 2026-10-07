// Pure display rules for the "Apps" page (Phase 15c). No data access, no React.
// The list is the device's own report of its launchable apps (`device_apps`): read-only here, informational.
import { DEVICE_APPS_INTERVAL_SECONDS, DEVICE_APPS_MAX } from "@familysafe/contracts";
import { secondsSince } from "@/lib/devices/status";

/** Columns read from `device_apps` — label, package, version, system flag only (no ids, no timestamps). */
export const APP_COLUMNS = "package_name,label,version_name,is_system";

/** A report counts as out of date after three missed daily syncs. */
export const APPS_STALE_SECONDS = DEVICE_APPS_INTERVAL_SECONDS * 3;
export const APPS_STALE_DAYS = Math.round(APPS_STALE_SECONDS / (24 * 3600));
export const APPS_SEARCH_MAX = 100;

export interface AppRow {
  packageName: string;
  label: string;
  versionName: string | null;
  isSystem: boolean;
}
export interface AppsInput {
  apps: AppRow[];
  /** `devices.apps_synced_at`: null until the device has reported at least once (an empty list still counts). */
  syncedAt: string | null;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Accepts a raw `device_apps` row; anything unusable → null (skipped, never invented). */
export function asAppRow(raw: unknown): AppRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.package_name !== "string" || r.package_name.length === 0) return null;
  if (typeof r.label !== "string" || r.label.trim().length === 0) return null;
  return {
    packageName: r.package_name,
    label: r.label,
    versionName: typeof r.version_name === "string" && r.version_name.length > 0 ? r.version_name : null,
    isSystem: r.is_system === true,
  };
}

export type AppKind = "all" | "user" | "system";
export interface AppsQuery {
  q: string;
  kind: AppKind;
}
type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Reads `?q=&kind=` from the URL. Control characters are dropped, the text is trimmed and capped; unknown kinds → all. */
export function parseAppsQuery(p: Params): AppsQuery {
  const rawQ = first(p.q);
  const q = typeof rawQ === "string" ? Array.from(rawQ.replace(CONTROL_CHARS, " ").trim()).slice(0, APPS_SEARCH_MAX).join("").trim() : "";
  const k = first(p.kind);
  return { q, kind: k === "user" || k === "system" ? k : "all" };
}

/** Stable order: label (case/accent-insensitive), then package name. */
export function sortApps(apps: readonly AppRow[]): AppRow[] {
  return [...apps].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.packageName.localeCompare(b.packageName, "en"));
}

/** Case-insensitive match on label or package name, plus the user/system filter. */
export function filterApps(apps: readonly AppRow[], query: AppsQuery): AppRow[] {
  const needle = query.q.toLowerCase();
  return apps.filter((a) => {
    if (query.kind === "user" && a.isSystem) return false;
    if (query.kind === "system" && !a.isSystem) return false;
    return needle === "" || a.label.toLowerCase().includes(needle) || a.packageName.toLowerCase().includes(needle);
  });
}

export function appCounts(apps: readonly AppRow[]): { total: number; user: number; system: number } {
  const system = apps.filter((a) => a.isSystem).length;
  return { total: apps.length, user: apps.length - system, system };
}

/** True once the device has reported its apps at least once (a valid `apps_synced_at`). */
export function hasReportedApps(p: Pick<AppsInput, "syncedAt">): boolean {
  return p.syncedAt !== null && !Number.isNaN(Date.parse(p.syncedAt));
}

/** "Not reported yet" | "Updated 3 hours ago" (relative text shared with "last seen"). */
export function appsUpdatedText(p: Pick<AppsInput, "syncedAt">, now: Date, relative: (iso: string | null, now: Date) => string): string {
  return hasReportedApps(p) ? `Updated ${relative(p.syncedAt, now).toLowerCase()}` : "Not reported yet";
}

/** The list may lag when the last report is older than three sync intervals. */
export function areAppsStale(p: Pick<AppsInput, "syncedAt">, now: Date): boolean {
  const age = secondsSince(p.syncedAt, now);
  return age !== null && age > APPS_STALE_SECONDS;
}

export const KIND_LABEL: Record<AppKind, string> = { all: "All apps", user: "Installed by the child", system: "System apps" };

/** "12 apps" / "3 of 12 apps" / "No apps match" — the line above the list. */
export function resultsText(shown: number, total: number): string {
  if (total === 0) return "No apps reported";
  if (shown === 0) return "No apps match";
  const noun = total === 1 ? "app" : "apps";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

/** Shown when the list is at the contract cap: the device may have sent only the first part. */
export const APPS_CAP_NOTE = `The device shares at most ${DEVICE_APPS_MAX} apps, so this list can be shorter than what is installed.`;
export const APPS_CAP = DEVICE_APPS_MAX;
