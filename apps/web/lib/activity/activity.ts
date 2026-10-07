// Pure display rules for the device "Activity" tab (20c-1). No data access, no React.
// Rows come from `device_events` (what the device reported or the backend noticed); metadata is read defensively and only
// the few known keys are ever shown (a package, a permission, a count, a time) — never the raw JSON.
import { PERMISSION_KEYS, type PermissionKey } from "@familysafe/contracts";
import { PERMISSION_LABEL } from "@/lib/devices/permissions";

/** Columns read from `device_events` (parents have SELECT; rows are written only by backend functions). */
export const ACTIVITY_COLUMNS = "id,event_type,metadata,created_at";
export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MIN_LIMIT = 10;
export const ACTIVITY_MAX_LIMIT = 200;
/** "Show more" grows the page by this many rows. */
export const ACTIVITY_STEP = 50;

export interface ActivityEvent {
  id: string;
  type: string;
  at: string; // ISO timestamp
  metadata: Record<string, unknown>;
}

export type ActivityTone = "neutral" | "warning";

export interface ActivityLine {
  id: string;
  title: string;
  detail: string | null;
  tone: ActivityTone;
  at: string;
}

const TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** `?limit=` from the URL: an integer clamped to 10–200; anything else is the default. */
export function parseLimit(params: Record<string, string | string[] | undefined>): number {
  const raw = params.limit;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string" || !/^[0-9]{1,4}$/.test(text)) return ACTIVITY_DEFAULT_LIMIT;
  return Math.min(ACTIVITY_MAX_LIMIT, Math.max(ACTIVITY_MIN_LIMIT, Number(text)));
}

/** The next "show more" size, or `null` when the maximum is already shown. */
export function nextLimit(current: number): number | null {
  return current >= ACTIVITY_MAX_LIMIT ? null : Math.min(ACTIVITY_MAX_LIMIT, current + ACTIVITY_STEP);
}

/** A raw `device_events` row → `ActivityEvent`; anything unusable → null (skipped, never invented). */
export function asActivityEvent(raw: unknown): ActivityEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (typeof r.event_type !== "string" || !TYPE_PATTERN.test(r.event_type)) return null;
  if (typeof r.created_at !== "string" || Number.isNaN(Date.parse(r.created_at))) return null;
  const metadata = typeof r.metadata === "object" && r.metadata !== null && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
  return { id: r.id, type: r.event_type, at: r.created_at, metadata };
}

const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100_000 ? v : null);

/** Packages named by events, so the page can look their labels up once. */
export function packagesIn(events: readonly ActivityEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    const p = text(e.metadata.package_name, 255);
    if (p !== null) set.add(p);
  }
  return [...set];
}

const STATE_LABEL: Record<string, string> = {
  GRANTED: "allowed",
  DENIED: "denied",
  REVOKED: "turned off",
  RESTRICTED: "restricted",
  NOT_AVAILABLE: "not available",
  NOT_REQUESTED: "not asked yet",
};
const stateLabel = (v: unknown): string => (typeof v === "string" ? (STATE_LABEL[v] ?? "unknown") : "unknown");
const permissionLabel = (v: unknown): string =>
  typeof v === "string" && (PERMISSION_KEYS as readonly string[]).includes(v) ? PERMISSION_LABEL[v as PermissionKey] : "A permission";

/** "SOME_EVENT_TYPE" → "Some event type": the fallback for types this page does not know yet. */
export function humanizeType(type: string): string {
  const words = type.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One line of the timeline. `labelFor` maps a package name to the app's label (or null when unknown). */
export function describeEvent(e: ActivityEvent, labelFor: (pkg: string) => string | null): ActivityLine {
  const base = { id: e.id, at: e.at };
  const appName = (): string | null => {
    const pkg = text(e.metadata.package_name, 255);
    return pkg === null ? null : (labelFor(pkg) ?? pkg);
  };
  switch (e.type) {
    case "DEVICE_ONLINE":
      return { ...base, title: "Device came online", detail: null, tone: "neutral" };
    case "DEVICE_OFFLINE":
      return { ...base, title: "Device went offline", detail: "It had not checked in for a while.", tone: "warning" };
    case "BATTERY_LOW":
      return { ...base, title: "Battery is low", detail: null, tone: "warning" };
    case "PERMISSION_STATE_CHANGED": {
      const to = e.metadata.to;
      const bad = to === "DENIED" || to === "REVOKED";
      return {
        ...base,
        title: "A permission changed",
        detail: `${permissionLabel(e.metadata.permission)}: ${stateLabel(e.metadata.from)} → ${stateLabel(to)}`,
        tone: bad ? "warning" : "neutral",
      };
    }
    case "APP_INSTALLED":
    case "APP_UNINSTALLED": {
      const verb = e.type === "APP_INSTALLED" ? "installed" : "removed";
      const n = count(e.metadata.count);
      const name = appName();
      if (name !== null) return { ...base, title: `App ${verb}`, detail: name, tone: "neutral" };
      if (n !== null) return { ...base, title: `${n} apps ${verb}`, detail: null, tone: "neutral" };
      return { ...base, title: `App ${verb}`, detail: null, tone: "neutral" };
    }
    case "BLOCKED_APP_ATTEMPT": {
      const name = appName();
      return { ...base, title: "A blocked app was opened", detail: name, tone: "warning" };
    }
    default:
      return { ...base, title: humanizeType(e.type), detail: null, tone: "neutral" };
  }
}

/** Short text above the list: how many are shown and whether more exist. */
export function activitySummary(shown: number, hasMore: boolean): string {
  if (shown === 0) return "Nothing has been reported yet.";
  return hasMore ? `Showing the latest ${shown} events.` : shown === 1 ? "Showing 1 event." : `Showing all ${shown} events.`;
}
