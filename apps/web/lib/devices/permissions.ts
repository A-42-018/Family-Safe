// Pure display rules for the "Permissions" page (Phase 14c). No data access, no React.
// Values are the device's own report of the OS grant state (`device_permissions`): informational, never proof.
import { PERMISSION_KEYS, PERMISSION_STATES, PERMISSION_SYNC_INTERVAL_SECONDS, type PermissionKey, type PermissionState } from "@familysafe/contracts";
import { secondsSince } from "@/lib/devices/status";

/** The permission columns read from `device_permissions` — exactly the contract catalog plus the verification time. */
export const PERMISSION_COLUMNS = `${PERMISSION_KEYS.map((k) => `${k}_status`).join(",")},last_verified_at`;

/** Device-reported states, keyed like the contract catalog. `null` = unusable value (never invented). */
export interface PermissionsInput {
  states: Record<PermissionKey, PermissionState | null>;
  lastVerifiedAt: string | null;
}

/** A report counts as out of date after three missed syncs. */
export const PERMISSIONS_STALE_SECONDS = PERMISSION_SYNC_INTERVAL_SECONDS * 3;
export const PERMISSIONS_STALE_HOURS = PERMISSIONS_STALE_SECONDS / 3600;

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  camera: "Camera",
  microphone: "Microphone",
  contacts: "Contacts",
  sms: "Text messages (SMS)",
  call_log: "Call history",
  location: "Approximate location",
  precise_location: "Precise location",
  background_location: "Location in the background",
};

/** Why the feature exists — informational, no promise about what the parent can see. */
export const PERMISSION_PURPOSE: Record<PermissionKey, string> = {
  camera: "Used only when the child starts something that needs it, such as scanning a code.",
  microphone: "Used only for features the child starts, such as an emergency call.",
  contacts: "Used for emergency and family contacts the child picks.",
  sms: "Reading messages is restricted by Android and Google Play, so this app does not use it.",
  call_log: "Reading call history is restricted by Android and Google Play, so this app does not use it.",
  location: "Needed before any location feature can work.",
  precise_location: "Needed for an exact position instead of a rough area.",
  background_location: "Needed only if location should update while the app is closed.",
};

export type PermissionBadgeVariant = "default" | "secondary" | "outline";
export interface PermissionStateCopy {
  label: string;
  text: string;
  variant: PermissionBadgeVariant;
}

/** Wording per state. Informational only: states what Android reported, makes no claim about the device. */
export const PERMISSION_STATE_COPY: Record<PermissionState, PermissionStateCopy> = {
  GRANTED: { label: "Allowed", text: "Android reports this as allowed on the device.", variant: "default" },
  DENIED: { label: "Not allowed", text: "The app asked and it was not allowed. The child can change this in Android settings.", variant: "secondary" },
  REVOKED: { label: "Turned off", text: "This was allowed before and has since been turned off on the device.", variant: "outline" },
  RESTRICTED: { label: "Limited", text: "Android or the device's settings limit this permission.", variant: "secondary" },
  NOT_AVAILABLE: { label: "Not available", text: "Feature unavailable under current Android/Play distribution requirements.", variant: "secondary" },
  NOT_REQUESTED: { label: "Not asked yet", text: "The app has not asked for this permission.", variant: "secondary" },
};

const STATE_SET: ReadonlySet<string> = new Set(PERMISSION_STATES);

/** Accepts only the CHECK-listed states; anything else (null, unknown string, prototype keys) → null. */
export function asPermissionState(v: unknown): PermissionState | null {
  return typeof v === "string" && STATE_SET.has(v) ? (v as PermissionState) : null;
}

/** True once the device has verified its permissions at least once (a valid `last_verified_at`). */
export function hasVerifiedPermissions(p: Pick<PermissionsInput, "lastVerifiedAt">): boolean {
  return p.lastVerifiedAt !== null && !Number.isNaN(Date.parse(p.lastVerifiedAt));
}

/** "Not reported yet" | "Updated 3 hours ago" (relative text shared with "last seen"). */
export function permissionsUpdatedText(p: Pick<PermissionsInput, "lastVerifiedAt">, now: Date, relative: (iso: string | null, now: Date) => string): string {
  return hasVerifiedPermissions(p) ? `Updated ${relative(p.lastVerifiedAt, now).toLowerCase()}` : "Not reported yet";
}

/** Reported values may lag when the last verification is older than three sync intervals. */
export function arePermissionsStale(p: Pick<PermissionsInput, "lastVerifiedAt">, now: Date): boolean {
  const age = secondsSince(p.lastVerifiedAt, now);
  return age !== null && age > PERMISSIONS_STALE_SECONDS;
}

export interface PermissionRow {
  key: PermissionKey;
  label: string;
  purpose: string;
  /** null until the device has verified (the stored defaults are placeholders, not observations). */
  state: PermissionState | null;
  stateLabel: string;
  stateText: string;
  variant: PermissionBadgeVariant;
  revoked: boolean;
}

/** One row per catalog permission, in contract order. Before the first verification no state is claimed. */
export function permissionRows(p: PermissionsInput): PermissionRow[] {
  const verified = hasVerifiedPermissions(p);
  return PERMISSION_KEYS.map((key) => {
    const state = verified ? asPermissionState(p.states[key]) : null;
    const copy = state ? PERMISSION_STATE_COPY[state] : null;
    return {
      key,
      label: PERMISSION_LABEL[key],
      purpose: PERMISSION_PURPOSE[key],
      state,
      stateLabel: copy?.label ?? (verified ? "Unknown" : "Not reported yet"),
      stateText: copy?.text ?? (verified ? "The device sent a value this page does not recognise." : "The app has not reported this yet."),
      variant: copy?.variant ?? "secondary",
      revoked: state === "REVOKED",
    };
  });
}

/** Labels of permissions that were allowed before and are now turned off (only after a verification). */
export function revokedLabels(p: PermissionsInput): string[] {
  return permissionRows(p).filter((r) => r.revoked).map((r) => r.label);
}

/** Low-key hint for the top of the page; null when nothing was turned off. */
export function revokedNotice(p: PermissionsInput): string | null {
  const labels = revokedLabels(p);
  if (labels.length === 0) return null;
  return labels.length === 1
    ? `${labels[0]} was turned off on the device.`
    : `${labels.length} permissions were turned off on the device: ${labels.join(", ")}.`;
}
