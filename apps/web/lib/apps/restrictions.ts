// Pure rules for per-app restrictions on `/devices/[id]/applications` (Phase 18b). No data access, no React.
// A rule restricts only while the app is blocked or has a daily limit (blocked wins; 0 minutes = no use that day).
// Track A honesty: these are stored settings; the child app can notice and inform, it cannot close apps (see ENFORCEMENT_NOTE).
import { APP_RULES_MAX, appRuleInputSchema, CHILD_APP_PACKAGE, DAILY_LIMIT_MAX_MINUTES, type AppRuleInput } from "@familysafe/contracts";
import type { FieldErrors } from "@/lib/auth/form-state";
import type { AppRow } from "@/lib/devices/apps";
import { minutesText } from "@/lib/devices/usage";
import { parseMinutes } from "@/lib/rules/rules";

/** Columns read from `app_rules` (parents have SELECT; the write path is the RPC only). `app_name` is not needed: labels come from the inventory. */
export const APP_RULE_COLUMNS = "package_name,blocked,daily_limit_minutes";

export interface AppRuleRow {
  packageName: string;
  blocked: boolean;
  /** Minutes a day; `null` = no limit. Kept while blocked (blocked wins). */
  dailyLimit: number | null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** A raw `app_rules` row → `AppRuleRow`; unusable rows and rows that restrict nothing → null (skipped, never invented). */
export function asAppRuleRow(raw: unknown): AppRuleRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.package_name !== "string" || r.package_name.length === 0) return null;
  if (typeof r.blocked !== "boolean") return null;
  const limit = r.daily_limit_minutes;
  if (limit !== null && !(isInt(limit) && limit >= 0 && limit <= DAILY_LIMIT_MAX_MINUTES)) return null;
  if (!r.blocked && limit === null) return null;
  return { packageName: r.package_name, blocked: r.blocked, dailyLimit: limit };
}

export type RestrictionState = { kind: "none" } | { kind: "blocked" } | { kind: "limited"; minutes: number };

/** Effective state of one app: blocked wins over a stored limit; no rule = no restriction. */
export function restrictionOf(rule: AppRuleRow | undefined): RestrictionState {
  if (!rule) return { kind: "none" };
  if (rule.blocked) return { kind: "blocked" };
  if (rule.dailyLimit !== null) return { kind: "limited", minutes: rule.dailyLimit };
  return { kind: "none" };
}

export function restrictionText(s: RestrictionState): string {
  if (s.kind === "none") return "No restriction";
  if (s.kind === "blocked") return "Blocked";
  return s.minutes === 0 ? "No use allowed (0 min a day)" : `Limit: ${minutesText(s.minutes)} a day`;
}

/** The FamilySafe child app is part of the system and can never be restricted (contract + SQL). */
export const canRestrict = (packageName: string): boolean => packageName !== CHILD_APP_PACKAGE;

export interface RestrictionRows {
  /** Inventory apps plus apps that still have a rule but are no longer reported (so the parent can clear them). */
  apps: AppRow[];
  states: ReadonlyMap<string, RestrictionState>;
  /** Packages with a rule that the device no longer reports. */
  unreported: number;
}

export function mergeRestrictions(apps: readonly AppRow[], rules: readonly AppRuleRow[]): RestrictionRows {
  const states = new Map<string, RestrictionState>();
  const known = new Set(apps.map((a) => a.packageName));
  const merged = [...apps];
  let unreported = 0;
  for (const rule of rules) {
    const state = restrictionOf(rule);
    if (state.kind === "none") continue;
    states.set(rule.packageName, state);
    if (!known.has(rule.packageName)) {
      unreported++;
      merged.push({ packageName: rule.packageName, label: rule.packageName, versionName: null, isSystem: false });
    }
  }
  return { apps: merged, states, unreported };
}

export interface RuleCounts { total: number; blocked: number; limited: number }

export function ruleCounts(rules: readonly AppRuleRow[]): RuleCounts {
  let blocked = 0;
  let limited = 0;
  for (const r of rules) {
    const s = restrictionOf(r);
    if (s.kind === "blocked") blocked++;
    else if (s.kind === "limited") limited++;
  }
  return { total: blocked + limited, blocked, limited };
}

export function ruleSummaryText(c: RuleCounts): string {
  if (c.total === 0) return "No app is restricted.";
  const parts: string[] = [];
  if (c.blocked > 0) parts.push(`${c.blocked} blocked`);
  if (c.limited > 0) parts.push(`${c.limited} with a daily limit`);
  return `${parts.join(", ")}.`;
}

export const RULES_CAP_NOTE = `A device can have at most ${APP_RULES_MAX} app restrictions. Remove one to add another.`;
export const atRuleCap = (c: RuleCounts): boolean => c.total >= APP_RULES_MAX;

// ---------------------------------------------------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------------------------------------------------

export const INTENTS = ["block", "limit", "clear"] as const;
export type Intent = (typeof INTENTS)[number];

export const FIELD = { deviceId: "device_id", packageName: "package_name", minutes: "minutes", intent: "intent" } as const;
/** The only form keys the action reads; everything else in the submission is ignored. */
export const APP_RULE_FORM_KEYS: readonly string[] = [FIELD.deviceId, FIELD.packageName, FIELD.minutes, FIELD.intent];

export const MINUTES_HINT = `Whole minutes, 1 to ${DAILY_LIMIT_MAX_MINUTES}.`;
const MINUTES_ERROR = `Enter whole minutes from 1 to ${DAILY_LIMIT_MAX_MINUTES}.`;

export type ParsedAppRule =
  | { ok: true; input: AppRuleInput; intent: Intent; values: Record<string, string> }
  | { ok: false; fieldErrors: FieldErrors; values: Record<string, string>; formError?: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Raw form fields → validated contract input. Pure; the contract schema has the last word and the database re-checks.
 * block → blocked, limit replaced by none; limit → not blocked, minutes 1..max; clear → no restriction.
 * The minutes box is read only for the `limit` intent, so a stray value can never leak into Block or Clear.
 */
export function parseAppRuleForm(raw: Record<string, unknown>): ParsedAppRule {
  const values: Record<string, string> = { [FIELD.minutes]: str(raw[FIELD.minutes]) };
  const intent = str(raw[FIELD.intent]);
  if (!(INTENTS as readonly string[]).includes(intent)) return { ok: false, fieldErrors: {}, values, formError: "Choose an action." };

  let blocked = false;
  let dailyLimit: number | null = null;
  if (intent === "block") blocked = true;
  else if (intent === "limit") {
    const m = parseMinutes(values[FIELD.minutes] ?? "");
    if (m === null) return { ok: false, fieldErrors: { [FIELD.minutes]: [MINUTES_ERROR] }, values };
    dailyLimit = m;
  }
  if (str(raw[FIELD.packageName]) === CHILD_APP_PACKAGE) return { ok: false, fieldErrors: {}, values, formError: CHILD_APP_MESSAGE };

  const parsed = appRuleInputSchema.safeParse({
    device_id: str(raw[FIELD.deviceId]),
    package_name: str(raw[FIELD.packageName]),
    blocked,
    daily_limit_minutes: dailyLimit,
  });
  if (!parsed.success) return { ok: false, fieldErrors: {}, values, formError: "That app can't be restricted." };
  return { ok: true, input: parsed.data, intent: intent as Intent, values };
}

// ---------------------------------------------------------------------------------------------------------------------
// Copy. Informational only: a setting is not proof that a phone follows it.
// ---------------------------------------------------------------------------------------------------------------------
export const CHILD_APP_MESSAGE = "This is the FamilySafe app itself and can't be restricted.";
export const UNCHANGED_MESSAGE = "No changes to save.";
export const INACTIVE_MESSAGE = "This device is no longer active, so its app restrictions can't be changed.";
export const UNKNOWN_APP_MESSAGE = "That app isn't in the list the device reported. Wait for the next app sync and try again.";
export const INVALID_MESSAGE = `Those settings aren't valid, or the device already has ${APP_RULES_MAX} app restrictions.`;
export const SAVED_NOTE = "The child's phone picks this up on its next sync.";

export function savedMessage(intent: Intent): string {
  if (intent === "block") return `Saved: this app is set to blocked. ${SAVED_NOTE}`;
  if (intent === "limit") return `Saved: daily limit set. ${SAVED_NOTE}`;
  return `Saved: restriction removed. ${SAVED_NOTE}`;
}

export const APP_RULES_NOTE =
  "Blocks and limits are settings stored for this device. From child app version 0.18.0 the child's phone checks them using Usage Access, only while the FamilySafe app is open and each time it is opened again (it then looks at what was opened since its last check). " +
  "Android does not let this app close other apps or lock the phone: it can only tell your child that a blocked app was opened or a limit was reached. " +
  "Each time a blocked app is opened, the app and the time are recorded for this device, but this website does not show those records yet. " +
  "A restriction on a system app can have side effects on the phone.";
