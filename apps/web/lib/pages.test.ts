// Structural guards for the Phase 6 shell: every prompt §35 route has a page, the shell stays data-free, and no inline scripts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICE_TABS } from "./nav";

const root = fileURLToPath(new URL("../", import.meta.url));
const appDir = `${root}app/(app)/`;
const read = (p: string): string => readFileSync(p, "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}${f}`;
    return statSync(p).isDirectory() ? walk(p + "/") : [p];
  });
}

const routes = [
  "dashboard", "children", "children/new", "children/[id]", "children/[id]/edit", "devices", "devices/[id]",
  ...DEVICE_TABS.map((t) => `devices/[id]/${t.slug}`),
  "notifications", "audit-logs", "settings", "settings/security",
];

describe("route stubs (prompt §35)", () => {
  it.each(routes)("%s has a page", (r) => expect(statSync(`${appDir}${r}/page.tsx`).isFile()).toBe(true));

  it("pages set a title (except the device index redirect)", () => {
    for (const r of routes.filter((x) => x !== "devices/[id]")) expect(read(`${appDir}${r}/page.tsx`)).toMatch(/metadata[^=]*=\s*\{\s*title:/);
  });

  it("has loading and error boundaries and a not-found page", () => {
    expect(statSync(`${appDir}loading.tsx`).isFile()).toBe(true);
    expect(read(`${appDir}error.tsx`)).toMatch(/^"use client"/);
    expect(statSync(`${root}app/not-found.tsx`).isFile()).toBe(true);
  });

  it("[id] segments are validated before use", () => {
    for (const f of ["children/[id]/page.tsx", "children/[id]/edit/page.tsx", "devices/[id]/layout.tsx", "devices/[id]/page.tsx"]) expect(read(`${appDir}${f}`)).toMatch(/isUuid\(/);
  });

  it("error boundary never renders error.message", () => expect(read(`${appDir}error.tsx`)).not.toMatch(/error\.message/));
});

describe("shell is data-free and script-free", () => {
  const shellFiles = [...walk(`${root}components/shell/`), ...walk(appDir)].filter((f) => /\.tsx?$/.test(f));
  const allowSupabase = new Set([`${appDir}layout.tsx`, `${appDir}settings/security/page.tsx`]);

  it("finds the shell files", () => expect(shellFiles.length).toBeGreaterThan(20));

  it("no data access outside the auth guard and security page", () => {
    for (const f of shellFiles.filter((x) => !allowSupabase.has(x))) {
      const src = read(f);
      expect(src, f).not.toMatch(/supabase|fetch\(|XMLHttpRequest|process\.env/i);
    }
  });

  it("no inline scripts, raw HTML injection or browser storage", () => {
    for (const f of shellFiles) expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|<script|localStorage|sessionStorage|document\.cookie|eval\(/);
  });

  it("no console logging", () => {
    for (const f of shellFiles) expect(read(f), f).not.toMatch(/console\.(log|info|debug)/);
  });
});

describe("accessibility wiring (static)", () => {
  const src = (name: string) => read(`${root}components/shell/${name}`);

  it("skip link targets a focusable main landmark", () => {
    const s = src("app-shell.tsx");
    expect(s).toContain('href="#main"');
    expect(s).toMatch(/<main id="main" tabIndex=\{-1\}/);
  });
  it("navigation landmarks are labelled and mark the current page", () => {
    expect(src("sidebar.tsx")).toContain('aria-label="Main"');
    expect(src("mobile-nav.tsx")).toContain('aria-label="Main"');
    expect(src("breadcrumbs.tsx")).toContain('aria-label="Breadcrumb"');
    expect(src("device-tabs.tsx")).toContain('aria-label="Device sections"');
    for (const f of ["nav-links.tsx", "breadcrumbs.tsx", "device-tabs.tsx"]) expect(src(f)).toContain("aria-current");
  });
  it("mobile drawer is a native modal dialog with labelled open/close buttons", () => {
    const s = src("mobile-nav.tsx");
    expect(s).toContain("<dialog");
    expect(s).toContain("showModal()");
    expect(s).toContain('aria-label="Open menu"');
    expect(s).toContain('aria-label="Close menu"');
    expect(s).toContain("aria-expanded");
  });
  it("user menu follows the menu pattern", () => {
    const s = src("user-menu.tsx");
    for (const t of ['role="menu"', 'role="menuitem"', 'role="menuitemradio"', "aria-haspopup", "aria-expanded", "Escape", "nextMenuIndex"]) expect(s).toContain(t);
  });
  it("decorative icons are hidden from assistive tech", () => expect(src("icons.tsx")).toContain('aria-hidden="true"'));
});

describe("Phase 7 family/child pages", () => {
  const src = (p: string) => read(`${root}${p}`);

  it("pages read data only through lib/family/queries (no direct client use in page files)", () => {
    for (const f of ["dashboard", "children", "children/new", "children/[id]", "children/[id]/edit"]) {
      expect(src(`app/(app)/${f}/page.tsx`), f).toContain("@/lib/family/queries");
    }
  });
  it("server actions file is 'use server' and validates through the service only", () => {
    const s = src("lib/family/actions.ts");
    expect(s).toMatch(/^"use server"/);
    expect(s).toContain("./service");
    expect(s).not.toMatch(/console\./);
  });
  it("service never logs row data and never trusts client-supplied ownership", () => {
    const s = src("lib/family/service.ts");
    for (const m of s.matchAll(/console\.error\(([^)]*)\)/g)) expect(m[1], m[0]).toMatch(/\.code\b/); // only the error code is ever logged
    expect(s).not.toMatch(/\.(parent_id|family_id)\s*=|raw\.(parent_id|family_id)/);
  });
  it("delete flows use the native dialog and warn about cascade", () => {
    const d = src("components/family/delete-dialog.tsx");
    expect(d).toContain("showModal()");
    expect(d).toContain('name="confirm"');
    expect(src("components/children/delete-child-dialog.tsx")).toMatch(/every device enrolled/);
    expect(src("components/family/family-forms.tsx")).toMatch(/all enrolled devices/);
  });
  it("date of birth never appears in a URL, link or query string", () => {
    for (const f of ["components/children/child-form.tsx", "components/children/child-card.tsx", "lib/family/actions.ts", "lib/family/queries.ts"]) {
      expect(src(f), f).not.toMatch(/href=\{?[`"'][^`"']*(dateOfBirth|date_of_birth|dob)/i);
    }
  });
  it("no dangerouslySetInnerHTML, inline scripts or browser storage in new components", () => {
    for (const f of [...walk(`${root}components/children/`), ...walk(`${root}components/family/`), `${root}components/shell/breadcrumb-labels.tsx`]) {
      expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|<script|localStorage|sessionStorage|document\.cookie|eval\(|console\./);
    }
  });
});

describe("Phase 8 enrollment UI", () => {
  const src = (p: string) => read(`${root}${p}`);

  it("child page reads devices only through lib/enrollment/queries and hosts the add-device flow", () => {
    const s = src("app/(app)/children/[id]/page.tsx");
    expect(s).toContain("@/lib/enrollment/queries");
    expect(s).toContain("AddDeviceDialog");
    expect(s).not.toMatch(/createSupabase|supabase\./);
  });
  it("server actions file is 'use server', delegates to the service and never logs", () => {
    const s = src("lib/enrollment/actions.ts");
    expect(s).toMatch(/^"use server"/);
    expect(s).toContain("./service");
    expect(s).not.toMatch(/console\./);
  });
  it("service logs only HTTP statuses (never bodies, codes, tokens or ids)", () => {
    const s = src("lib/enrollment/service.ts");
    for (const m of s.matchAll(/console\.error\(([^)]*)\)/g)) expect(m[1], m[0]).toMatch(/http_\$\{status\}/);
  });
  it("service never persists or exposes the access token beyond the Authorization header", () => {
    const s = src("lib/enrollment/service.ts");
    expect(s).not.toMatch(/localStorage|sessionStorage|cookies\(|document\./);
    expect(s.match(/access_token/g)?.length).toBe(1);
  });
  it("device queries never select credential or push-token columns", () => {
    const s = src("lib/enrollment/queries.ts");
    expect(s).toMatch(/const DEVICE_COLUMNS =\s*"[^"]*"/);
    const cols = /const DEVICE_COLUMNS =\s*"([^"]*)"/.exec(s)?.[1] ?? "";
    expect(cols).not.toMatch(/fcm|token|credential|hash|refresh/i);
  });
  it("add-device dialog uses the native dialog, drops the code on close and states that the app stays visible", () => {
    const s = src("components/devices/add-device-dialog.tsx");
    for (const t of ["showModal()", "onClose", "key={generation}", "aria-live", "stays visible"]) expect(s).toContain(t);
    expect(s).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\.|dangerouslySetInnerHTML|navigator\.clipboard/);
  });
  it("revoke goes through the confirm dialog with the explicit token", () => {
    const s = src("components/devices/revoke-device-dialog.tsx");
    expect(s).toContain('confirmValue="revoke"');
    expect(src("components/family/delete-dialog.tsx")).toContain("confirmValue");
  });
  it("new components have no inline scripts, storage, eval or console", () => {
    for (const f of walk(`${root}components/devices/`)) {
      expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|<script|localStorage|sessionStorage|document\.cookie|eval\(|console\./);
    }
  });
});

describe("Phase 12c heartbeat display", () => {
  const src = (p: string) => read(`${root}${p}`);

  it("status rule imports the stale window from contracts instead of hard-coding it", () => {
    const s = src("lib/devices/status.ts");
    expect(s).toContain("HEARTBEAT_STALE_SECONDS");
    expect(s).not.toMatch(/\b2700\b/);
  });
  it("device queries select heartbeat columns but no credential or push columns", () => {
    const cols = /export const DEVICE_COLUMNS =\s*"([^"]*)"/.exec(src("lib/enrollment/queries.ts"))?.[1] ?? "";
    for (const c of ["battery_level", "is_charging", "network_type", "last_seen_at", "app_version"]) expect(cols).toContain(c);
    expect(cols).not.toMatch(/fcm|token|credential|hash|refresh/i);
    expect(src("lib/devices/queries.ts")).not.toMatch(/console\./);
  });
  it("device pages read only through lib/devices/queries and validate the id", () => {
    const o = src("app/(app)/devices/[id]/overview/page.tsx");
    expect(o).toContain("@/lib/devices/queries");
    expect(o).toMatch(/isUuid\(/);
    expect(o).toContain("<AutoRefresh");
    for (const f of ["app/(app)/devices/page.tsx", "app/(app)/dashboard/page.tsx"]) expect(src(f), f).toContain("@/lib/devices/queries");
  });
  it("auto-refresh is a client component using router.refresh, no storage, no logging, no fetch", () => {
    const c = src("components/devices/auto-refresh.tsx");
    expect(c).toMatch(/^"use client"/);
    expect(c).toContain("router.refresh()");
    expect(c).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\.|fetch\(|supabase/i);
    expect(src("lib/devices/auto-refresh.ts")).toContain("visibilitychange");
  });
  it("pages never print raw ids or the device token columns", () => {
    for (const f of ["app/(app)/devices/[id]/overview/page.tsx", "app/(app)/devices/page.tsx"]) expect(src(f), f).not.toMatch(/fcm|credential|refresh_token/i);
  });
});

describe("Phase 13c device information card", () => {
  const src = (p: string) => read(`${root}${p}`);

  it("device queries select the five info columns and still no credential/push columns", () => {
    const cols = /export const DEVICE_COLUMNS =\s*"([^"]*)"/.exec(src("lib/enrollment/queries.ts"))?.[1] ?? "";
    for (const c of ["sdk_level", "security_patch", "storage_total_mb", "storage_free_mb", "info_updated_at"]) expect(cols).toContain(c);
    expect(cols).not.toMatch(/fcm|token|credential|hash|refresh|serial|imei/i);
  });
  it("overview renders the card; card and rules are data-free and never print raw ids", () => {
    expect(src("app/(app)/devices/[id]/overview/page.tsx")).toContain("<DeviceInfoCard");
    const card = src("components/devices/device-info-card.tsx");
    expect(card).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|device\.id/i);
    expect(card).toContain('role="progressbar"');
    expect(src("lib/devices/info.ts")).not.toMatch(/console\.|supabase|fetch\(/);
  });
  it("info rules import interval and limits from contracts instead of hard-coding them", () => {
    const s = src("lib/devices/info.ts");
    for (const n of ["DEVICE_INFO_INTERVAL_SECONDS", "isSecurityPatchDate", "SDK_LEVEL_MAX", "STORAGE_MB_MAX"]) expect(s).toContain(n);
    expect(s).not.toMatch(/\b86400\b|16777216/);
  });
});

describe("Phase 14c permissions page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/permissions/page.tsx");

  it("page validates the id, answers 404 via RLS, renders the card and refreshes", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("<PermissionsCard");
    expect(page).toContain("<AutoRefresh");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("card and rules are data-free, never print raw ids and never call the device 'secure'", () => {
    const card = src("components/devices/permissions-card.tsx");
    expect(card).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|device\.id/i);
    expect(card).toContain('data-testid="permissions-revoked-notice"');
    const rules = src("lib/devices/permissions.ts");
    expect(rules).not.toMatch(/console\.|supabase|fetch\(/);
    expect(rules).not.toMatch(/\b(secure|safe|protected)\b/i);
  });
  it("rules import the catalog and interval from contracts instead of hard-coding them", () => {
    const rules = src("lib/devices/permissions.ts");
    for (const n of ["PERMISSION_KEYS", "PERMISSION_STATES", "PERMISSION_SYNC_INTERVAL_SECONDS"]) expect(rules).toContain(n);
    expect(rules).not.toMatch(/\b21600\b/);
  });
  it("the query reads only device_permissions through the catalog columns (no secrets)", () => {
    const q = src("lib/devices/queries.ts");
    expect(q).toContain('from("device_permissions")');
    expect(q).toContain("PERMISSION_COLUMNS");
    expect(src("lib/devices/permissions.ts")).not.toMatch(/fcm|credential|refresh_token|token_hash/i);
  });
});

describe("Phase 15c applications page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/applications/page.tsx");

  it("page validates the id, answers 404 via RLS, renders the card and refreshes", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("<AppsCard");
    expect(page).toContain("<AutoRefresh");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("search is a plain GET form: the card is a server component with no data access, no raw ids and no write code of its own (writes live in AppRuleControls, Phase 18b)", () => {
    const card = src("components/devices/apps-card.tsx");
    expect(card).toContain('method="get"');
    expect(card).not.toMatch(/"use client"|supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|device\.id|onClick|formAction|method="post"/i);
    expect(card).toContain('data-testid="apps-card"');
    const rules = src("lib/devices/apps.ts");
    expect(rules).not.toMatch(/console\.|supabase|fetch\(/);
    expect(rules).not.toMatch(/\b(secure|safe|protected)\b/i);
  });
  it("limits come from contracts instead of being hard-coded", () => {
    const rules = src("lib/devices/apps.ts");
    for (const n of ["DEVICE_APPS_INTERVAL_SECONDS", "DEVICE_APPS_MAX"]) expect(rules).toContain(n);
    expect(rules).not.toMatch(/\b86400\b|\b500\b/);
  });
  it("the query reads only devices.apps_synced_at and device_apps through the four columns (no secrets, no write)", () => {
    const q = src("lib/devices/queries.ts");
    expect(q).toContain('from("device_apps")');
    expect(q).toContain("APP_COLUMNS");
    expect(q).not.toMatch(/from\("device_apps"\)\s*\.(insert|update|delete|upsert)/);
    expect(src("lib/devices/apps.ts")).not.toMatch(/fcm|credential|refresh_token|token_hash/i);
  });
});

describe("Phase 16c-1 usage page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/usage/page.tsx");

  it("page validates the id, answers 404 via RLS, renders the card and refreshes", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("<UsageCard");
    expect(page).toContain("<AutoRefresh");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("the chart is plain links: no client component, no data access, no write controls, no raw ids", () => {
    const card = src("components/devices/usage-card.tsx");
    expect(card).toContain('data-testid="usage-card"');
    expect(card).toContain("?day=");
    expect(card).not.toMatch(/"use client"|supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|device\.id|onClick|formAction|method="post"|recharts/i);
    const rules = src("lib/devices/usage.ts");
    expect(rules).not.toMatch(/console\.|supabase|fetch\(/);
    expect(rules).not.toMatch(/\b(secure|safe|protected)\b/i);
  });
  it("limits come from contracts instead of being hard-coded", () => {
    const rules = src("lib/devices/usage.ts");
    for (const n of ["DEVICE_USAGE_INTERVAL_SECONDS", "DEVICE_USAGE_MAX_APPS", "DEVICE_USAGE_MAX_MINUTES", "DEVICE_USAGE_MAX_COUNT", "DEVICE_USAGE_FUTURE_DAYS"]) expect(rules).toContain(n);
    expect(rules).not.toMatch(/\b21600\b|\b1440\b|\b10000\b/);
  });
  it("the query is SELECT-only on the three tables it names and reads no secret columns", () => {
    const q = src("lib/devices/queries.ts");
    for (const t of ["device_usage_daily", "app_usage_daily", "usage_synced_at"]) expect(q).toContain(t);
    expect(q).not.toMatch(/from\("(device_usage_daily|app_usage_daily)"\)\s*\.(insert|update|delete|upsert)/);
    expect(src("lib/devices/usage.ts")).not.toMatch(/fcm|credential|refresh_token|token_hash/i);
  });
});

describe("Phase 16c-2 dashboard screen-time card", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/dashboard/page.tsx");

  it("the dashboard card is real: summary from the pure rules, no data access in the page", () => {
    expect(page).toContain("loadTodayScreenTime");
    expect(page).toContain("summarizeToday");
    expect(page).toContain("todayHint(today)");
    expect(page).toContain("todayValue(today)");
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("rules are pure, informational and take limits from contracts", () => {
    const rules = src("lib/devices/screen-time.ts");
    expect(rules).not.toMatch(/console\.|supabase|fetch\(/);
    expect(rules).not.toMatch(/\b(secure|safe|protected)\b/i);
    expect(rules).not.toMatch(/\b21600\b|\b1440\b|\b86400\b/);
    expect(rules).toContain("DEVICE_USAGE_FUTURE_DAYS");
  });
  it("the query is SELECT-only, scoped to enrolled devices, and reads no secret columns", () => {
    const q = src("lib/devices/queries.ts");
    const fn = q.slice(q.indexOf("export async function fetchTodayScreenTime"));
    expect(fn).toContain("TODAY_USAGE_COLUMNS");
    expect(fn).toContain("usage_synced_at");
    expect(fn).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(fn).not.toMatch(/fcm|credential|refresh_token|token_hash/i);
  });
});

describe("Phase 17b screen-time rules web", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/rules/page.tsx");
  const PAGE_FORBIDDEN = /supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i;

  it("page validates the id, answers 404 via RLS, and composes the card and the form without touching data itself", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("loadDeviceRules");
    expect(page).toContain("<RulesCard");
    expect(page).toContain("<RulesForm");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(PAGE_FORBIDDEN);
  });
  it("only an enrolled device gets the form; the form is remounted when the stored version moves", () => {
    expect(page).toContain('device.enrollmentStatus === "ENROLLED"');
    expect(page).toContain("key={rules.configVersion}");
  });
  it("the card is presentational and read-only", () => {
    const card = src("components/devices/rules-card.tsx");
    expect(card).toContain('data-testid="rules-card"');
    expect(card).toContain("ENFORCEMENT_NOTE");
    expect(card).not.toMatch(/"use client"|supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|device\.id|onClick|formAction/i);
  });
  it("the form posts through the Server Action, sends no version or overrides blob, and stores nothing in the browser", () => {
    const form = src("components/devices/rules-form.tsx");
    expect(form.startsWith('"use client"')).toBe(true);
    expect(form).toContain("saveScreenTimeRulesAction");
    expect(form).toContain("FIELD.deviceId");
    expect(form).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|config_version|configVersion/i);
  });
  it("rules are pure, informational and take limits from contracts", () => {
    const rules = src("lib/rules/rules.ts");
    expect(rules).not.toMatch(/console\.|supabase|fetch\(/);
    expect(rules).not.toMatch(/\b(secure|safe|protected)\b/i);
    expect(rules).not.toMatch(/\b1440\b|\b86400\b|\b21600\b/);
    for (const n of ["DAILY_LIMIT_MAX_MINUTES", "ISO_WEEKDAYS", "screenTimeRulesInputSchema", "effectiveDailyLimitMinutes", "dayLimitOverridesSchema"]) expect(rules).toContain(n);
  });
  it("copy never promises a hard lock", () => {
    const rules = src("lib/rules/rules.ts");
    expect(rules).toContain("does not let this app lock the phone");
    expect(rules).not.toMatch(/\b(cannot be bypassed|unbypassable|guaranteed|locked out)\b/i);
  });
  it("the service writes only through the RPC, never a table, and logs only an operation name and a code", () => {
    const svc = src("lib/rules/service.ts");
    expect(svc).toContain('rpc("parent_set_screen_time_rules"');
    expect(svc).not.toMatch(/\.from\(|\.(insert|update|delete|upsert)\(/);
    const logs = [...svc.matchAll(/console\.error\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).toMatch(/^"rules_save_failed", (error\.code \?\? "unknown"|"unexpected_outcome")$/);
    expect(svc).toContain("DEVICE_RULES.write");
  });
  it("the action reads only the known form keys and revalidates the rules page and the dashboard", () => {
    const actions = src("lib/rules/actions.ts");
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).toContain("RULES_FORM_KEYS");
    expect(actions).toContain("revalidatePath");
    expect(actions).toContain('"/dashboard"');
    expect(actions).not.toMatch(/console\./);
  });
  it("reads are SELECT-only on device_rules with an explicit column list", () => {
    const q = src("lib/rules/queries.ts");
    expect(q).toContain('from("device_rules")');
    expect(q).toContain("RULES_COLUMNS");
    expect(q).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(q).not.toMatch(/select\("\*"\)|fcm|credential|refresh_token|token_hash/i);
  });
  it("no web code writes device_rules directly (overrides and the version only change through the RPC)", () => {
    const files = ["app", "lib", "components"].flatMap((d) => walk(`${root}${d}/`)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(read(f), f).not.toMatch(/from\(\s*"device_rules"\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\(/);
  });
  it("the dashboard card is real: summary from the pure rules, no data access in the page", () => {
    const dash = src("app/(app)/dashboard/page.tsx");
    expect(dash).toContain("loadRestrictionsInput");
    expect(dash).toContain("summarizeRestrictions");
    expect(dash).toContain("restrictionsHint(restrictions)");
    expect(dash).toContain("restrictionsValue(restrictions)");
    expect(dash).not.toContain("Limits, blocked apps and schedules in effect.");
    expect(dash).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
});

describe("Phase 18b app restrictions web", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/applications/page.tsx");
  const FORBIDDEN = /supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i;

  it("the page loads the rules next to the list and offers controls only for an enrolled device, without touching data itself", () => {
    expect(page).toContain("loadAppRules");
    expect(page).toContain('device.enrollmentStatus === "ENROLLED"');
    expect(page).toContain("restrictions={{");
    expect(page).not.toMatch(FORBIDDEN);
  });
  it("the card stays a server component and mounts the per-app controls only when editable", () => {
    const card = src("components/devices/apps-card.tsx");
    expect(card).toContain("<AppRuleControls");
    expect(card).toContain("restrictions.editable");
    expect(card).toContain("canRestrict(");
    expect(card).toContain("APP_RULES_NOTE");
    expect(card).not.toMatch(/"use client"|supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|onClick|formAction|method="post"/i);
  });
  it("the controls post through the Server Action, store nothing in the browser, and Enter can only set a limit", () => {
    const c = src("components/devices/app-rule-controls.tsx");
    expect(c.startsWith('"use client"')).toBe(true);
    expect(c).toContain("saveAppRuleAction");
    expect(c).toContain("FIELD.deviceId");
    expect(c).toContain("FIELD.packageName");
    expect(c).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|config_version|configVersion/i);
    // The first submit button in DOM order is the one Enter triggers: it must be "limit", never "block".
    const limit = c.indexOf('<IntentButton intent="limit">');
    const block = c.indexOf('<IntentButton intent="block">');
    const clear = c.indexOf('<IntentButton intent="clear">');
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(block);
    expect(limit).toBeLessThan(clear);
  });
  it("restrictions are pure, informational, and take limits from contracts", () => {
    const r = src("lib/apps/restrictions.ts");
    expect(r).not.toMatch(/console\.|supabase|fetch\(/);
    expect(r).not.toMatch(/\b(secure|safe|protected)\b/i);
    expect(r).not.toMatch(/\b1440\b|\b200\b/);
    for (const n of ["APP_RULES_MAX", "appRuleInputSchema", "CHILD_APP_PACKAGE", "DAILY_LIMIT_MAX_MINUTES"]) expect(r).toContain(n);
    expect(r).not.toMatch(/\b(cannot be bypassed|unbypassable|guaranteed|locked out)\b/i);
    expect(r).toContain("does not let this app close other apps or lock the phone");
  });
  it("the service writes only through the RPC, never a table, and logs only an operation name and a code", () => {
    const svc = src("lib/apps/service.ts");
    expect(svc).toContain('rpc("parent_set_app_rule"');
    expect(svc).not.toMatch(/\.from\(|\.(insert|update|delete|upsert)\(/);
    const logs = [...svc.matchAll(/console\.error\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).toMatch(/^"app_rule_save_failed", (error\.code \?\? "unknown"|"unexpected_outcome")$/);
    expect(svc).toContain("APP_RULES.write");
    // order: id check → field validation → verified user → rate limit → RPC
    const order = ["isUuid(deviceId)", "parseAppRuleForm(raw)", "auth.getUser()", "checkRateLimit(", ".rpc("].map((n) => svc.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the action reads only the known form keys and revalidates the applications page and the dashboard", () => {
    const a = src("lib/apps/actions.ts");
    expect(a.startsWith('"use server"')).toBe(true);
    expect(a).toContain("APP_RULE_FORM_KEYS");
    expect(a).toContain("/applications`");
    expect(a).toContain('"/dashboard"');
    expect(a).not.toMatch(/console\./);
  });
  it("reads are SELECT-only on app_rules with explicit columns", () => {
    const q = src("lib/apps/queries.ts");
    expect(q).toContain('from("app_rules")');
    expect(q).toContain("APP_RULE_COLUMNS");
    expect(q).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(q).not.toMatch(/select\("\*"\)|fcm|credential|refresh_token|token_hash/i);
  });
  it("no web code writes app_rules directly (rules only change through the RPC)", () => {
    const files = ["app", "lib", "components"].flatMap((d) => walk(`${root}${d}/`)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(read(f), f).not.toMatch(/from\(\s*"app_rules"\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\(/);
  });
  it("the dashboard counts app rules through the query layer; the page stays data-free", () => {
    const dash = src("app/(app)/dashboard/page.tsx");
    expect(dash).toContain("loadAppRuleCounts");
    expect(dash).toContain("appRuleCounts");
    expect(dash).not.toMatch(FORBIDDEN);
  });
  it("the service has its own rate-limit rule", () => {
    expect(src("lib/security/ratelimit.ts")).toMatch(/export const APP_RULES = \{[\s\S]*?name: "app-rules-write"/);
  });
});

describe("Phase 19b schedules web", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/schedules/page.tsx");
  const FORBIDDEN = /supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i;

  it("the page validates the id, answers 404 via RLS, loads through the query layer and never touches data itself", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("loadSchedules");
    expect(page).toContain("loadTimezone");
    expect(page).toContain("<SchedulesCard");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(FORBIDDEN);
  });
  it("only an enrolled device gets the forms; the forms remount when the stored values change", () => {
    expect(page).toContain('device.enrollmentStatus === "ENROLLED"');
    expect(page).toContain("<ScheduleForm");
    expect(page).toContain("<TimezoneForm");
    expect(page).toContain("key={editing?.id");
    expect(page).toContain("timezone === undefined");
  });
  it("the card is a server component; writes live only in the per-row client controls", () => {
    const card = src("components/devices/schedules-card.tsx");
    expect(card).toContain('data-testid="schedules-card"');
    expect(card).toContain("<ScheduleRowControls");
    expect(card).toContain("SCHEDULES_NOTE");
    expect(card).not.toMatch(/"use client"|supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|onClick|formAction|method="post"/i);
  });
  it("forms post through Server Actions, store nothing in the browser and have a single submit button", () => {
    for (const f of ["schedule-form.tsx", "schedule-row-controls.tsx", "timezone-form.tsx"]) {
      const c = src(`components/devices/${f}`);
      expect(c.startsWith('"use client"'), f).toBe(true);
      expect(c, f).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML|config_version|configVersion|schedules_revision/i);
    }
    expect(src("components/devices/schedule-form.tsx")).toContain("saveScheduleAction");
    expect(src("components/devices/timezone-form.tsx")).toContain("setTimezoneAction");
    const rows = src("components/devices/schedule-row-controls.tsx");
    expect(rows).toContain("deleteScheduleAction");
    expect(rows).toContain("<details");
  });
  it("the time zone is a fixed list, never free text", () => {
    const tz = src("components/devices/timezone-form.tsx");
    expect(tz).toContain("<select");
    expect(tz).not.toMatch(/type="text"/);
  });
  it("schedules rules are pure, informational and take limits from contracts", () => {
    const r = src("lib/schedules/schedules.ts");
    expect(r).not.toMatch(/console\.|supabase|fetch\(/);
    expect(r).not.toMatch(/\b(secure|safe|protected)\b/i);
    expect(r).not.toMatch(/\b1440\b|\b10080\b|\b20\b(?!:)/);
    for (const n of ["SCHEDULES_MAX", "SCHEDULE_NAME_MAX", "SCHEDULE_TYPES", "scheduleInputSchema", "schedulesOverlap", "timezoneInputSchema"]) expect(r).toContain(n);
    expect(r).not.toMatch(/\b(cannot be bypassed|unbypassable|guaranteed|locked out)\b/i);
  });
  it("reads are SELECT-only; no web code writes schedules or device_rules.timezone directly", () => {
    const q = src("lib/schedules/queries.ts");
    expect(q).toContain('from("schedules")');
    expect(q).toContain("SCHEDULE_COLUMNS");
    expect(q).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
    expect(q).not.toMatch(/select\("\*"\)|fcm|credential|refresh_token|token_hash/i);
    const files = ["app", "lib", "components"].flatMap((d) => walk(`${root}${d}/`)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const f of files) expect(read(f), f).not.toMatch(/from\(\s*"schedules"\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\(/);
  });
  it("the service uses the three RPCs and its own rate-limit rule", () => {
    const s = src("lib/schedules/service.ts");
    for (const n of ["parent_save_schedule", "parent_delete_schedule", "parent_set_device_timezone", "SCHEDULES.write"]) expect(s).toContain(n);
    expect(s).not.toMatch(/\.from\(/);
    expect(src("lib/security/ratelimit.ts")).toMatch(/export const SCHEDULES = \{[\s\S]*?name: "schedules-write"/);
  });
  it("the dashboard counts schedules through the query layer; the page stays data-free", () => {
    const dash = src("app/(app)/dashboard/page.tsx");
    expect(dash).toContain("loadScheduleCounts");
    expect(dash).toContain("scheduleCounts");
    expect(dash).not.toMatch(FORBIDDEN);
  });
});

describe("Phase 20c-1 activity page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/devices/[id]/activity/page.tsx");

  it("page validates the id, answers 404 via RLS, renders the card and refreshes", () => {
    expect(page).toContain("isUuid(id)");
    expect(page).toMatch(/notFound\(\)/);
    expect(page).toContain("<ActivityCard");
    expect(page).toContain("<AutoRefresh");
    expect(page).toContain("<BreadcrumbLabel");
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("the read side is SELECT only and the card has no controls that write", () => {
    const queries = src("lib/activity/queries.ts");
    expect(queries).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(queries).not.toMatch(/console\.|dangerouslySetInnerHTML/);
    const card = src("components/devices/activity-card.tsx");
    expect(card).toContain('data-testid="activity-card"');
    expect(card).not.toMatch(/"use client"|<form|<button|onClick|dangerouslySetInnerHTML|supabase/i);
  });
  it("raw event metadata is never rendered", () => {
    expect(src("components/devices/activity-card.tsx")).not.toMatch(/metadata/);
    expect(src("lib/activity/activity.ts")).not.toMatch(/JSON\.stringify/);
  });
});

describe("Phase 30b audit-log page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/audit-logs/page.tsx");

  it("the page parses its filters, renders the list and holds no data-access code of its own", () => {
    expect(page).toContain("parseAuditFilters(");
    expect(page).toContain("<AuditList");
    expect(page).toMatch(/metadata[^=]*=\s*\{\s*title:/);
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("the read side only calls the list RPC and the card is a plain GET form with no write controls", () => {
    const queries = src("lib/audit/queries.ts");
    expect(queries).toContain('rpc("parent_list_audit_logs"');
    expect(queries).not.toMatch(/\.(insert|update|upsert|delete)\(|\.from\(/);
    expect(queries).not.toMatch(/console\./);
    const card = src("components/audit/audit-list.tsx");
    expect(card).toContain('data-testid="audit-card"');
    expect(card).toContain('method="get"');
    expect(card).not.toMatch(/"use client"|method="post"|action=\{|onClick|dangerouslySetInnerHTML|supabase/i);
  });
  it("raw metadata is never rendered and the IP is shown for sign-ins only", () => {
    expect(src("components/audit/audit-list.tsx")).not.toMatch(/metadata/);
    expect(src("lib/audit/audit.ts")).not.toMatch(/JSON\.stringify/);
    expect(src("lib/audit/audit.ts")).toMatch(/ip: row\.action === "LOGIN" \? row\.ip : null/);
  });
});

describe("Phase 29b notifications page", () => {
  const src = (p: string) => read(`${root}${p}`);
  const page = src("app/(app)/notifications/page.tsx");

  it("the page parses its limit, renders the list and holds no data-access code of its own", () => {
    expect(page).toContain("parseNotificationsLimit(");
    expect(page).toContain("<NotificationList");
    expect(page).toContain("<AutoRefresh");
    expect(page).toMatch(/metadata[^=]*=\s*\{\s*title:/);
    expect(page).not.toMatch(/supabase|fetch\(|localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/i);
  });
  it("the read side only selects and the write side only calls the one RPC through a Server Action", () => {
    const queries = src("lib/notifications/queries.ts");
    expect(queries).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(queries).not.toMatch(/console\./);
    expect(src("lib/notifications/service.ts")).toContain('rpc("parent_mark_notifications_read"');
    expect(src("lib/notifications/service.ts")).not.toMatch(/\.from\(|\.(insert|update|delete)\(/);
    expect(src("lib/notifications/actions.ts")).toMatch(/^"use server"/);
  });
  it("the list uses plain forms (no client JavaScript) and never renders raw metadata", () => {
    const card = src("components/notifications/notification-list.tsx");
    expect(card).toContain('data-testid="notifications-card"');
    expect(card).not.toMatch(/"use client"|onClick|dangerouslySetInnerHTML|supabase|metadata/i);
    expect(src("lib/notifications/notifications.ts")).not.toMatch(/JSON\.stringify/);
  });
  it("the layout and the dashboard read the unread count without ever failing the page", () => {
    expect(src("app/(app)/layout.tsx")).toContain("loadUnreadCount()");
    expect(src("app/(app)/dashboard/page.tsx")).toContain("alertsValue(unread)");
    expect(src("lib/notifications/queries.ts")).toMatch(/catch \{\s*return null;/);
  });
});

describe("Phase 29c notification preferences", () => {
  const src = (p: string) => read(`${root}${p}`);
  it("settings renders the card and never shows an unreadable choice as 'on'", () => {
    const page = src("app/(app)/settings/page.tsx");
    expect(page).toContain("<PreferencesCard");
    expect(page).toContain("loadPreferences()");
    expect(page).toMatch(/\.catch\(\(\) => null\)/);
    expect(src("components/notifications/preferences-card.tsx")).toContain('data-testid="preferences-unreadable"');
  });
  it("the card is plain forms with fixed values; always-on rows have no control", () => {
    const card = src("components/notifications/preferences-card.tsx");
    expect(card).not.toMatch(/"use client"|onClick|dangerouslySetInnerHTML|supabase/i);
    expect(card).toContain("r.alwaysOn ? (");
    expect(src("lib/notifications/service.ts")).toContain('rpc("parent_set_notification_preference"');
  });
});
