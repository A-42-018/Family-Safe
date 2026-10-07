// Pure display rules for the notifications page, the unread badge and the dashboard Alerts card (29b). No data access, no React.
// Rows come from `notifications` (SELECT as the signed-in parent). Metadata is read through a whitelist: a permission key
// and a security reason, nothing else.
import { NOTIFICATION_TYPES, PERMISSION_KEYS, type NotificationType, type PermissionKey } from "@familysafe/contracts";
import { PERMISSION_LABEL } from "@/lib/devices/permissions";

/** Columns read from `notifications` plus the device name (a to-one join under RLS). */
export const NOTIFICATION_COLUMNS = "id,type,metadata,created_at,read_at,devices(device_name)";
export const NOTIFICATIONS_DEFAULT_LIMIT = 30;
export const NOTIFICATIONS_MAX_LIMIT = 150;
export const NOTIFICATIONS_STEP = 30;
/** The badge shows "9+" above this. */
export const BADGE_MAX = 9;

export interface NotificationRow {
  id: string;
  type: NotificationType;
  deviceName: string | null;
  metadata: Record<string, unknown>;
  at: string; // ISO timestamp
  readAt: string | null;
}

const isType = (v: unknown): v is NotificationType => typeof v === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(v);
const deviceNameOf = (d: unknown): string | null => {
  const one = Array.isArray(d) ? d[0] : d;
  const name = typeof one === "object" && one !== null ? (one as Record<string, unknown>).device_name : null;
  return typeof name === "string" && name !== "" ? name : null;
};

/** A raw row → `NotificationRow`; anything unusable → null (skipped, never invented). */
export function asNotificationRow(raw: unknown): NotificationRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (!isType(r.type)) return null;
  if (typeof r.created_at !== "string" || Number.isNaN(Date.parse(r.created_at))) return null;
  const readAt = typeof r.read_at === "string" && !Number.isNaN(Date.parse(r.read_at)) ? r.read_at : null;
  const metadata = typeof r.metadata === "object" && r.metadata !== null && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
  return { id: r.id, type: r.type, deviceName: deviceNameOf(r.devices), metadata, at: r.created_at, readAt };
}

export type NotificationTone = "urgent" | "warning" | "neutral";
export interface NotificationLine {
  id: string;
  title: string;
  detail: string | null;
  tone: NotificationTone;
  unread: boolean;
  at: string;
}

const TITLE: Record<NotificationType, { title: string; tone: NotificationTone }> = {
  DEVICE_OFFLINE: { title: "Device offline", tone: "warning" },
  BATTERY_LOW: { title: "Battery low", tone: "warning" },
  EMERGENCY: { title: "Emergency alert", tone: "urgent" },
  GEOFENCE_ENTER: { title: "Arrived at a place", tone: "neutral" },
  GEOFENCE_EXIT: { title: "Left a place", tone: "neutral" },
  PERMISSION_REVOKED: { title: "A permission was turned off", tone: "warning" },
  LIMIT_REACHED: { title: "Screen-time limit reached", tone: "neutral" },
  BLOCKED_APP_ATTEMPT: { title: "A blocked app was opened", tone: "warning" },
  DEVICE_ENROLLED: { title: "Device paired", tone: "neutral" },
  SECURITY_EVENT: { title: "Security notice", tone: "urgent" },
};

const permissionLabel = (v: unknown): string | null =>
  typeof v === "string" && (PERMISSION_KEYS as readonly string[]).includes(v) ? PERMISSION_LABEL[v as PermissionKey] : null;

/** One line of the list. The text is fixed per type; only the device name and a permission label are filled in. */
export function describeNotification(row: NotificationRow): NotificationLine {
  const { title, tone } = TITLE[row.type];
  const device = row.deviceName;
  let detail: string | null = null;
  switch (row.type) {
    case "DEVICE_OFFLINE":
      detail = device ? `${device} stopped checking in.` : "A device stopped checking in.";
      break;
    case "BATTERY_LOW":
      detail = device ? `${device} has a low battery.` : "A device has a low battery.";
      break;
    case "PERMISSION_REVOKED": {
      const p = permissionLabel(row.metadata.permission);
      detail = p ? (device ? `${p} on ${device}.` : `${p}.`) : (device ?? null);
      break;
    }
    case "SECURITY_EVENT":
      detail = row.metadata.reason === "credential_reuse"
        ? `${device ?? "A device"} was removed because its sign-in was used twice. Pair it again if it is yours.`
        : (device ?? null);
      break;
    default:
      detail = device;
  }
  return { id: row.id, title, detail, tone, unread: row.readAt === null, at: row.at };
}

/** "3", "9+" or null when there is nothing unread. */
export function unreadBadge(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 1) return null;
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(Math.floor(count));
}

type Params = Record<string, string | string[] | undefined>;
/** `?limit=` from the URL: an integer clamped to 30–150; anything else is the default. */
export function parseNotificationsLimit(params: Params): number {
  const raw = params.limit;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string" || !/^[0-9]{1,4}$/.test(text)) return NOTIFICATIONS_DEFAULT_LIMIT;
  return Math.min(NOTIFICATIONS_MAX_LIMIT, Math.max(NOTIFICATIONS_DEFAULT_LIMIT, Number(text)));
}

export function nextNotificationsLimit(current: number): number | null {
  return current >= NOTIFICATIONS_MAX_LIMIT ? null : Math.min(NOTIFICATIONS_MAX_LIMIT, current + NOTIFICATIONS_STEP);
}

export function notificationsSummary(shown: number, unread: number, hasMore: boolean): string {
  if (shown === 0) return "You're all caught up. Alerts such as a low battery or a device going offline will appear here.";
  const u = unread === 0 ? "Nothing unread" : unread === 1 ? "1 unread" : `${unread} unread`;
  return `${u}. ${hasMore ? `Showing the latest ${shown}.` : shown === 1 ? "Showing 1 notification." : `Showing all ${shown}.`}`;
}

/** Dashboard Alerts card: the count as text, or undefined when it could not be read. */
export function alertsValue(unread: number | null): string | undefined {
  return unread === null ? undefined : String(unread);
}

export function alertsHint(unread: number | null): string {
  if (unread === null) return "Your notifications could not be read.";
  return unread === 0 ? "Nothing needs your attention." : unread === 1 ? "1 unread notification needs your attention." : `${unread} unread notifications need your attention.`;
}
