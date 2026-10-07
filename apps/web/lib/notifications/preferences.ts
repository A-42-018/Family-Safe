// Pure rules for the notification preferences card on /settings (29c). No data access, no React.
// A type that was never stored counts as enabled; EMERGENCY and SECURITY_EVENT are always on (the RPC refuses "off").
import { NOTIFICATION_TYPES, isAlwaysOn, type NotificationType } from "@familysafe/contracts";

/** Columns read from `notification_preferences` (SELECT as the signed-in parent). */
export const PREFERENCE_COLUMNS = "type,enabled";

export const PREFERENCE_LABEL: Record<NotificationType, { title: string; description: string }> = {
  DEVICE_OFFLINE: { title: "Device offline", description: "A device has stopped checking in for a while." },
  BATTERY_LOW: { title: "Battery low", description: "A device's battery is low and it is not charging." },
  EMERGENCY: { title: "Emergency alert", description: "Your child pressed the emergency button." },
  GEOFENCE_ENTER: { title: "Arrived at a place", description: "A device entered a place you set up." },
  GEOFENCE_EXIT: { title: "Left a place", description: "A device left a place you set up." },
  PERMISSION_REVOKED: { title: "A permission was turned off", description: "Something that was allowed on the phone is now off." },
  LIMIT_REACHED: { title: "Screen-time limit reached", description: "A device reached today's limit." },
  BLOCKED_APP_ATTEMPT: { title: "A blocked app was opened", description: "Your child opened an app you blocked." },
  DEVICE_ENROLLED: { title: "Device paired", description: "A new device was paired with your family." },
  SECURITY_EVENT: { title: "Security notice", description: "Something unusual happened with a device's sign-in." },
};

export interface PreferenceRow {
  type: NotificationType;
  title: string;
  description: string;
  enabled: boolean;
  alwaysOn: boolean;
}

/** A raw `notification_preferences` row → `[type, enabled]`; anything unusable → null. */
export function asPreference(raw: unknown): [NotificationType, boolean] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !(NOTIFICATION_TYPES as readonly string[]).includes(r.type)) return null;
  if (typeof r.enabled !== "boolean") return null;
  return [r.type as NotificationType, r.enabled];
}

/** Every type in the contract's order; always-on types read as on whatever is stored. */
export function preferenceRows(stored: ReadonlyMap<NotificationType, boolean>): PreferenceRow[] {
  return NOTIFICATION_TYPES.map((type) => {
    const alwaysOn = isAlwaysOn(type);
    return { type, ...PREFERENCE_LABEL[type], alwaysOn, enabled: alwaysOn ? true : (stored.get(type) ?? true) };
  });
}

export const PREFERENCE_SAVED = "Saved.";
export const PREFERENCE_UNCHANGED = "No change.";
