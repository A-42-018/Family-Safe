// Pure display and URL rules for the audit-log page (30b). No data access, no React.
// Rows come from the RPC `parent_list_audit_logs` (the signed-in parent's own rows). Metadata is read through a
// whitelist: only the few known keys with known values ever reach the page, never the raw JSON.
import { PERMISSION_KEYS, type PermissionKey } from "@familysafe/contracts";
import { PERMISSION_LABEL } from "@/lib/devices/permissions";
import { isUuid } from "@/lib/ids";

export const AUDIT_PAGE_SIZE = 25;

/** Actions the filter offers (prompt §39). Rows with another action are still listed, just not filterable by name. */
export const AUDIT_ACTIONS = [
  "LOGIN", "DEVICE_ENROLLED", "DEVICE_REMOVED", "RULE_CHANGED", "APP_BLOCKED", "APP_UNBLOCKED", "PERMISSION_STATE_CHANGED",
  "LOCATION_VIEWED", "LOCATION_SETTINGS_CHANGED", "DEVICE_COMMAND_SENT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: "Sign-in",
  DEVICE_ENROLLED: "Device paired",
  DEVICE_REMOVED: "Device removed",
  RULE_CHANGED: "Rules changed",
  APP_BLOCKED: "App blocked",
  APP_UNBLOCKED: "App unblocked",
  PERMISSION_STATE_CHANGED: "Permission change noticed",
  LOCATION_VIEWED: "Location viewed",
  LOCATION_SETTINGS_CHANGED: "Location settings changed",
  DEVICE_COMMAND_SENT: "Command sent to a device",
};

const ACTION_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const isKnownAction = (a: string): a is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(a);

export interface AuditRow {
  id: string;
  action: string;
  deviceId: string | null;
  deviceName: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  at: string; // ISO timestamp
}

/** A raw RPC row (`o_*` columns) → `AuditRow`; anything unusable → null (skipped, never invented). */
export function asAuditRow(raw: unknown): AuditRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.o_id !== "string" || !isUuid(r.o_id)) return null;
  if (typeof r.o_action !== "string" || !ACTION_PATTERN.test(r.o_action)) return null;
  if (typeof r.o_created_at !== "string" || Number.isNaN(Date.parse(r.o_created_at))) return null;
  const meta = typeof r.o_metadata === "object" && r.o_metadata !== null && !Array.isArray(r.o_metadata) ? (r.o_metadata as Record<string, unknown>) : {};
  return {
    id: r.o_id,
    action: r.o_action,
    deviceId: typeof r.o_device_id === "string" && isUuid(r.o_device_id) ? r.o_device_id : null,
    deviceName: typeof r.o_device_name === "string" && r.o_device_name !== "" ? r.o_device_name : null,
    metadata: meta,
    ip: typeof r.o_ip === "string" && /^[0-9a-fA-F:.]{2,45}$/.test(r.o_ip) ? r.o_ip : null,
    at: r.o_created_at,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Filters (GET form) and the cursor
// ---------------------------------------------------------------------------------------------------------------------
export interface AuditCursor {
  at: string; // ISO timestamp of the last row of the previous page
  id: string;
}
export interface AuditFilters {
  action: string | null;
  device: string | null;
  /** `YYYY-MM-DD` (UTC day), inclusive. */
  from: string | null;
  to: string | null;
  before: AuditCursor | null;
}

type Params = Record<string, string | string[] | undefined>;
const first = (p: Params, k: string): string | null => {
  const v = p[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : null;
};

/** `YYYY-MM-DD` that is a real calendar date. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2020 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Everything unusable simply becomes "no filter"; the page never errors on a hand-edited URL. */
export function parseAuditFilters(p: Params): AuditFilters {
  const action = first(p, "action");
  const device = first(p, "device");
  let from = first(p, "from");
  let to = first(p, "to");
  if (from !== null && !isCalendarDate(from)) from = null;
  if (to !== null && !isCalendarDate(to)) to = null;
  if (from !== null && to !== null && from > to) to = null; // an empty range is dropped, not an error
  const at = first(p, "before_at");
  const id = first(p, "before_id");
  const cursorOk = at !== null && id !== null && isUuid(id) && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(at) && !Number.isNaN(Date.parse(at));
  return {
    action: action !== null && isKnownAction(action) ? action : null,
    device: device !== null && isUuid(device) ? device : null,
    from,
    to,
    before: cursorOk ? { at: at as string, id: id as string } : null,
  };
}

/** True when any filter (not the cursor) is set. */
export const isFiltering = (f: AuditFilters): boolean => f.action !== null || f.device !== null || f.from !== null || f.to !== null;

const nextDay = (ymd: string): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString();

/** Named arguments of `parent_list_audit_logs`; one extra row is requested to learn whether an older page exists. */
export function toRpcArgs(f: AuditFilters): Record<string, string | number | null> {
  return {
    p_action: f.action,
    p_device_id: f.device,
    p_from: f.from === null ? null : `${f.from}T00:00:00.000Z`,
    p_to: f.to === null ? null : nextDay(f.to),
    p_before_at: f.before?.at ?? null,
    p_before_id: f.before?.id ?? null,
    p_limit: AUDIT_PAGE_SIZE + 1,
  };
}

/** Query string for a link (filters + optional cursor); empty values are left out. */
export function auditQuery(f: AuditFilters, cursor: AuditCursor | null): string {
  const q = new URLSearchParams();
  if (f.action) q.set("action", f.action);
  if (f.device) q.set("device", f.device);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (cursor) {
    q.set("before_at", cursor.at);
    q.set("before_id", cursor.id);
  }
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Row text
// ---------------------------------------------------------------------------------------------------------------------
const FIELD_LABEL: Record<string, string> = {
  daily_screen_limit_minutes: "daily limit",
  daily_limit_overrides: "weekday limits",
  app_rules: "app rules",
  timezone: "time zone",
  schedules: "schedules",
  blocked: "blocked state",
};
const REASON_TEXT: Record<string, string> = { revoked: "removed from the dashboard", credential_reuse: "removed after a security check" };
const METHOD_TEXT: Record<string, string> = { password: "with a password", mfa_totp: "with two-step verification" };

const uniq = (xs: string[]): string[] => [...new Set(xs)];

function permissionNames(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  const out: string[] = [];
  for (const c of changes) {
    const key = typeof c === "object" && c !== null ? (c as Record<string, unknown>).permission : null;
    if (typeof key === "string" && (PERMISSION_KEYS as readonly string[]).includes(key)) out.push(PERMISSION_LABEL[key as PermissionKey]);
  }
  return uniq(out);
}

export interface AuditLine {
  id: string;
  title: string;
  detail: string | null;
  device: string | null;
  ip: string | null;
  at: string;
}

export function humanizeAction(action: string): string {
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One line of the log. The IP is shown for sign-ins only; nothing else from `metadata` than the whitelist below. */
export function describeAudit(row: AuditRow): AuditLine {
  const title = isKnownAction(row.action) ? ACTION_LABEL[row.action] : humanizeAction(row.action);
  let detail: string | null = null;
  const m = row.metadata;
  if (row.action === "LOGIN") {
    detail = typeof m.method === "string" ? (METHOD_TEXT[m.method] ?? null) : null;
  } else if (row.action === "RULE_CHANGED" || row.action === "APP_BLOCKED" || row.action === "APP_UNBLOCKED") {
    const fields = Array.isArray(m.fields) ? uniq(m.fields.flatMap((f) => (typeof f === "string" && FIELD_LABEL[f] ? [FIELD_LABEL[f] as string] : []))) : [];
    detail = row.action === "RULE_CHANGED" && fields.length > 0 ? `Changed: ${fields.join(", ")}` : null;
  } else if (row.action === "DEVICE_REMOVED") {
    detail = typeof m.reason === "string" ? (REASON_TEXT[m.reason] ?? null) : null;
  } else if (row.action === "PERMISSION_STATE_CHANGED") {
    const names = permissionNames(m.changes);
    detail = names.length > 0 ? names.join(", ") : null;
  }
  return { id: row.id, title, detail, device: row.deviceName, ip: row.action === "LOGIN" ? row.ip : null, at: row.at };
}

export function auditSummary(shown: number, filtering: boolean, hasOlder: boolean): string {
  if (shown === 0) return filtering ? "No entries match these filters." : "Nothing has been recorded yet.";
  const base = shown === 1 ? "Showing 1 entry" : `Showing ${shown} entries`;
  return hasOlder ? `${base}, newest first.` : `${base}.`;
}
