# plan.md — Living Plan (compact, v2)

Full history of Phases 1–19b: `docs/PLAN_ARCHIVE.md` (grep it, never read it whole). Roadmap briefs: `docs/DEVELOPMENT_PLAN.md` (read only your own `### <id>` section; new M0/T-briefs are at its top). Master requirements: `prompt.md`.

## Current status
**Last finished:** 19b — Schedules, web. **Plan v2 (2026-10-07):** roadmap regrouped into 9 demoable milestones (M0–M8), ~85 sessions in total (8 merges offset by 6 new), MVP reachable in ~36. No source code changed.
**Repo:** https://github.com/A-42-018/Family-Safe (branch `main`) — commit + push after every sub-phase, then ZIP.
**Next step:** M0-2 — walking skeleton (needs Docker + Supabase CLI + emulator; ask before installing), then M1.

## Verified 2026-10-07 (real toolchains, macOS, Node 22.12, Deno 2.9.6)
| Check | Result |
|---|---|
| `npm run check` | ✅ structure + secrets OK |
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 0 warnings (after M0-1) |
| `npm run test:contracts` | ✅ 312 / 312 (11 files) |
| `npm run test:web` | ✅ 618 / 618 (39 files) |
| `npm run build:web` | ✅ 29 routes |
| `npm run test:functions` (Deno) | ✅ 214 / 214 |
| `deno check */index.ts` | ✅ all 13 functions |
| pgTAP `scripts/db/verify.sh` | ✅ green in GitHub CI (first run 2026-10-07; not run locally) |
| Gradle `assembleDebug` | ✅ compiled first try (Kotlin 2.2.21, AGP 8.13, JDK 21 locally / 17 in CI) |
| Gradle `testDebugUnitTest` | ✅ 702 / 702 (after 7 test-side fixes) |
| ktlint · Android lint · manifest guard | ✅ clean |
→ **H1a, H1b, H2a, H2b, H2c are done.** The Kotlin worry was unfounded: main code compiled unchanged; only test code and style needed fixes (list in phase log). Local Android build: `cd apps/android && echo "sdk.dir=<sdk path>" > local.properties` (gitignored), `JAVA_HOME` = JDK 17–21 (not 25).

## Session rules (how every sub-phase is sized)
1. One sub-phase = one session = ONE layer: SQL | Edge+contracts | web | Android-domain | Android-data/work | Android-UI | docs | verify-fix. **Exception (v2):** two S-sized sub-phases of the same feature may share a session when listed as `a+b` in the roadmap.
2. Budget: ≤ 1 migration OR ≤ 1 Edge function OR ≤ 1 web page/feature OR ≤ 1 Android slice; about ≤ 8 new source files + ≤ 5 test files. Android never mixes domain + data + UI in one session.
3. Start: read this file + your `### <id>` brief + only the files the brief names under *Touch*. Do not open PLAN_ARCHIVE or unrelated docs.
4. Docs: touch only docs whose facts changed, ≤ 10 lines each; the last sub-phase of a feature does the doc sweep.
5. plan.md update after each sub-phase: status line + ≤ 12-line phase-log entry + ≤ 8 lines of decisions that bind later phases.
6. **Verification (v2):** a sub-phase is ☑ only when the CI job for its layer is green (web / functions / database / android). If it could not be run, mark it ◐ ("code complete, unverified") — never ☑. No more than **2 ◐ sub-phases in a row** on the same layer; the next session is then a verify-fix.
7. Checkpoint: finish the files of the current step, update plan.md, then commit (and build the ZIP). If the session is getting long, STOP coding early, split the rest into `<id>b`.
8. ZIP = the whole project + plan.md, no secrets, no `node_modules`/build output, ONE file. **Git is the source of truth; the ZIP is a hand-off copy.** One commit per sub-phase: `<id>: <scope>`.
9. **New RPC granted to `authenticated` → add its name to the allow-list in `supabase/tests/database/01_schema.test.sql` ("anon/authenticated/PUBLIC cannot execute…").** New file → add to `scripts/check-structure.mjs` list. New permission → manifest + allow-list + Permissions copy + child transparency text in the same change. New wire field → contracts + Edge mirror + drift test (+ Kotlin drift test) in the same sub-phase chain. **New Edge function → add it to both `deno check` and `deno test` lists in `package.json` and `ci.yml`.**
10. **Demo gate:** each milestone ends with a demo checkpoint (short script in its brief). Do not start the next milestone until the demo runs on the local stack + emulator.

## Standing rules (distilled from locked decisions)
- **Auth split:** parent = Supabase session (RLS); device = own HS256 JWT + rotating refresh token. Every device endpoint calls `requireActiveDevice` (uncached, device id only from the JWT, uniform 401). Parent endpoints use `requireParent`.
- **Parent writes** go only through `SECURITY DEFINER` RPCs (`search_path=''`, ownership in SQL, foreign ≙ missing → 404, outcomes mapped generically). Web never writes tables directly (structural guards).
- **Web layering:** contracts Zod → `lib/<x>/service.ts` (order: UUID → field validation → `auth.getUser` → rate limit → RPC) → `actions.ts` → `queries.ts`; page files hold no Supabase code. No browser token. Logs = operation name + error code only. `AutoRefresh` 60 s for live pages.
- **Rules reach the device by pull only** (`device-config`, ETag `"v<N>"`, 304). FCM = wake-up `{type:"SYNC", cmd_id}`, never data. Config changes bump `config_version` in triggers; the sealed cache codec is versioned (bump when the payload changes; old cache = no cache).
- **Android:** manual `AppContainer`; Ktor; `bearerAuth(` only in `KtorDeviceHttp`; standard outcome mapping (2xx sent; 401/429/5xx/network → retry; other 4xx → fail this run; NotEnrolled/Disconnected → cancel); sealed stores; unique periodic + one-off WorkManager jobs; access token memory-only; no `Log.`/printStackTrace in main; drift tests read contracts + Edge mirror + SQL.
- **Honesty (Track A):** the app detects and informs; it cannot lock the phone or close other apps. Hard block = **Track B (Device Owner)**, now planned in M1 (T-phases) as an opt-in deployment mode, never the default. Copy must not say secure/safe/protected/guaranteed/locked out/cannot be bypassed; Track B copy says "managed mode".
- **Never claim before the first report;** a missing day/row is "no data", never 0.
- **Privacy:** no sensitive data in FCM, logs, URLs, analytics. Location reads only through an audited RPC (`LOCATION_VIEWED`). **Hard gate:** parent direct `SELECT` on `location_points` (granted in `…000800_rls_policies.sql:169`) is revoked in 21a-2 **before** any device uploads a point. Retention: location 7/30/90 d, usage 90 d, audit 180 d. No IP stored for enrollment.
- **Time:** usage day = child's local date; schedule zone NULL = the device's own zone; overnight window belongs to its start day; windows are half-open.
- **Limiters** are in-memory (per Edge isolate ⇒ weak) until 31a. **Edge** tests: Deno with `--no-config --import-map=deno.json`; DB: `scripts/db/verify.sh`; web: vitest; Kotlin: JVM tests + drift tests.

## Done
| Phases | What |
|---|---|
| 1–8 | repo, Supabase config, migrations, RLS, parent auth, dashboard shell, family/child CRUD, enrollment backend — verified |
| 9–11b | Android foundation, enrollment, device auth (backend verified; Kotlin never compiled) |
| 12a–15c | heartbeat, device info, permission sync, app inventory (backend + web verified; Kotlin never compiled) |
| 16a–19b | usage, screen-time rules, app restrictions, schedules SQL/Edge/web (web + Edge + contracts verified 2026-10-07; pgTAP 13–15 + Kotlin not run) |

## Open carry-over
Read receipt ("device applied vN") → 20a-1 · limit-reached event → 29d · legacy `bedtime_*`/`school_mode_enabled` → 19d · offline sweep → 32a · in-memory limiters → 31a · no QR image → 27a · no self-service unenroll → 32d · refresh expiry slides forever → 31b-1 · audit IP is web-supplied → 31b-2.

## Roadmap v2 — milestones
Each milestone is a vertical, demoable slice. Sub-phase IDs and briefs are unchanged from v1 unless marked **NEW** or **merged** (`a+b` = one session). Layer: V · SQL · EDGE · WEB · A-DOM · A-DATA · A-UI · DOC. Status: ☐ todo · ◐ code complete, unverified · ☑ verified.

### MVP cut line
**M0–M2 + M4-core + 24 (emergency) = submission-ready product** (~36 sessions). M3, the rest of M4/M5, M6–M8 are stretch / production-prep in that order. If time is short, cut from the bottom of the list, never from M0.

### M0 — Make it real: verify + first end-to-end run (≈ 6 sessions)
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| H1b | V | npm ci, typecheck, lint, vitest, next build | M | ☑ 2026-10-07 |
| H1a | V | contracts ☑ + Deno ☑ + pgTAP ☑ (CI) | S | ☑ 2026-10-07 |
| M0-1 | V | **NEW** git init + GitHub + push; fix CI Deno test list; fix lint warning; CI 5 jobs visible | S | ☑ 2026-10-07 |
| H2a | V | first Gradle compile; fix compile errors (may need H2a-b, H2a-c) | M | ☑ 2026-10-07 |
| H2b | V | JVM unit + drift tests | M | ☑ 2026-10-07 (702) |
| H2c | V | ktlint, Android lint, manifest guard | S | ☑ 2026-10-07 |
| M0-2 | V | **NEW** walking skeleton on local stack (pulls 33a forward): `supabase start` → sign up → child → pairing code → emulator enrolls → heartbeat/device info/apps/usage visible on web → set a limit → device pulls config | M | ☐ |
**Demo:** the M0-2 script, recorded as `docs/DEMO.md`. **CI must be fully green before M1.**

### M1 — Screen-time core complete + real enforcement option (≈ 8 sessions)
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| 19c-1 | A-DOM | `ScheduleConfig` + pure evaluator + DST/zone tests | M | ☑ 2026-10-07 (+24 tests) |
| 19c-2 | A-DATA | DTO `timezone`/`schedules`; codec v3; drop drift exclusion | M | ☑ 2026-10-07 |
| 19c-3 | A-UI | triggers, WorkManager re-eval, quiet-time state, copy | M | ☑ 2026-10-07 |
| 19d-1+2 | SQL+EDGE / WEB | **merged** drop legacy columns + remove web legacy display | S+S | ☑ 2026-10-07 |
| T1 | DOC | **NEW** Track B decision: Device Owner via `adb shell dpm set-device-owner` (test/demo + enterprise only), capability matrix, what stays Track A | S | ☑ 2026-10-07 |
| T2 | A-DATA | **NEW** `DeviceAdminReceiver` (BIND_DEVICE_ADMIN), `ManagedModeDetector`, DPM adapter interface (fake in tests); manifest guard updated deliberately | M | ☑ 2026-10-07 |
| T3 | A-DOM+DATA | **NEW** enforcement port: Track A = notice (existing), Track B = `setPackagesSuspended` for BLOCKED/LIMIT apps + schedule windows; unsuspend on rule removal/disconnect | M | ☑ 2026-10-07 |
| T4 | A-UI+WEB | **NEW** "Managed mode" on child Device status + web device overview badge; copy distinguishes inform vs enforce | S | ☑ 2026-10-07 |
**Demo:** create bedtime schedule on web → emulator shows quiet-time notice; on a Device-Owner emulator a blocked app is actually suspended.

### M2 — Parent visibility from data that already exists (≈ 9 sessions)
Fills 3 of the 5 placeholder pages without any new device work.
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| 20c-1 | WEB | activity tab: `device_events` timeline (commands added after M3) — **moved before FCM** | M | ☑ 2026-10-07 |
| 30a | SQL | audit list RPC, APP_BLOCKED/UNBLOCKED, 180 d purge fn | M | ☑ 2026-10-07 |
| 30b | WEB | `/audit-logs` page | M | ☑ 2026-10-07 |
| 29a-1 | SQL | notifications + preferences tables, RLS, RPC | M | ☑ 2026-10-07 |
| 29a-2 | SQL | producers (offline, battery low, permission revoked, blocked-app attempt, enrollment, security event) | M | ☑ 2026-10-07 |
| 29b | WEB | `/notifications` list + unread badge + dashboard Alerts card | M | ☑ 2026-10-07 |
| 29c | WEB | preferences UI | S | ☑ 2026-10-07 |
| 29d-1+2 | SQL+EDGE / A-DATA | **merged** limit-reached event + upload | S+S | ☑ 2026-10-07 |
| 32a | SQL | **moved up** retention fns + schedule + stale-offline sweep (needed for "device offline" notifications) | M | ☐ |
**Demo:** kill emulator network → device turns offline on dashboard and a notification appears; audit log shows the rule change.

### M3 — Command sync / FCM (≈ 7 sessions) — stretch for MVP; config pull already works without it
20a-1 · 20a-2 · 20a-3 · 20b-1 · 20b-2 · 20b-3 · 20c-2 (briefs unchanged). **Decide first in 20a-3:** scheduled drain (simpler, no pg_net) recommended over DB webhook. Needs a Firebase project + service account as Edge secret.
**Demo:** "Refresh device now" on web → emulator pulls config within seconds.

### M4 — Location (≈ 13 sessions)
**Core (MVP):** 21a-1 · 21a-2 (**includes the location_points SELECT revoke — hard gate**) · 21a-3 · 21b-1 · 21b-2 · 21b-3 · 21c-1 · 21c-2.
**Extended:** 21b-4 (background, Play declaration) · 22a · 22b · 22c · 22d.
Map provider suggestion for 21c-2 (confirm with research): MapLibre GL / Leaflet with a free-tier vector/raster provider; avoid public OSM tiles beyond light demo use (tile usage policy).
**Demo:** enable location on web → child grants permission → latest location card + map marker; audit log shows `LOCATION_VIEWED`.

### M5 — Safety features (≈ 16 sessions)
**24 Emergency (MVP):** 24a-1 · 24a-2 · 24b-1 · 24b-2 · 24c.
**25 Safety contacts:** 25a-1+2 (**merged**) · 25b · 25c.
**23 Geofencing (needs 21b-4):** 23a-1 · 23a-2 · 23a-3 · 23b-1 · 23b-2 · 23c-1 · 23c-2 · 23c-3.
**Demo:** child presses emergency → web alert with battery/network/location → parent acknowledges.

### M6 — Compliance-only capabilities (≈ 5 sessions)
26a+28a (**merged** DOC: SMS/call log/phone state + microphone assessment) · 26b · 27a (QR image) · 27b-1 · 27b-2. 28b–28e stay optional (skip unless go/no-go says yes and time remains).

### M7 — Hardening + privacy (≈ 12 sessions)
31a-1 · 31a-2+3 (**merged**) · 31b-1 · 31b-2 · 31c · 31d · 31e-1 (absorbs 30c audit-coverage tests) · 31e-2 · 32b · 32c · 32d · 32e.

### M8 — Integration + release (≈ 9 sessions)
33b · 33c · 33d · 33e ×2 · 34a · 34b · 34c+34d (**merged** DOC) · 34e. (33a was done as M0-2.) Optional: 29e email, 29f web push.

## Risks (watch list)
1. **Kotlin never compiled for 10 phases** — expect several fix sessions in H2; budgeted H2a-b/H2a-c. Local machine has JDK 21 but no Android SDK; use Android Studio or CI.
2. pgTAP for 17a–19a (incl. 177 tests in `15_schedules`) never executed.
3. System never run end-to-end → M0-2 before any new feature.
4. Track A cannot block apps → T1–T4 give an honest, real enforcement mode for demos.
5. FCM credentials (Firebase project, service account, OAuth in Deno) — M3 is not on the MVP path for this reason.
6. In-memory limiters are per Edge isolate → effectively off in production until 31a.

## Phase log (latest)
- **29d-1+2** — Limit reached reaches the parent: Android upload slice (29d-2). `LimitReportPlanner` (queues once per local day when the check says LIMIT; older unsent day replaced; time clamped to ≤ now and ≥ 23 h back), sealed `LimitReportStore` (codec `v1;lastDay;pendingDay;millis`), DTO `{day, occurred_at}`, repository → `device-limit-events`, `LimitReportRunner`/`Worker` (sent or refused both mark the day done; retries keep it; disconnect clears), WorkManager unique `limit-report-now`; hooked through `LimitCheckRunner(onStatus=…)` (last constructor parameter). **Child-visible disclosure updated:** limit note and the limit-reached screen now say the parent is told that the limit was reached and when, nothing about apps; the old 'sends nothing to your parent' claim is gone (guards updated). Web ENFORCEMENT_NOTE updated. Also fixes 19_notification_producers (stale stored off → 'updated'; plan 36). JVM 826, web 717, Deno 227, contracts 360 green.
- **29d-1** — Limit-reached event backend. Migration `20261007000600_limit_reached_event.sql`: `device_record_limit_reached(device, day, time)` (service_role only; ENROLLED else 'inactive'; day ±1 UTC day, time −24 h…+5 min else 22023; nothing stored when no limit is configured but the answer is the same; one `LIMIT_REACHED` event per device per day with metadata **day + time only**; no liveness/audit/command side effects); Edge `device-limit-events` (strict `{day, occurred_at}`, auth before validation, narrower Edge windows, rate limits 6/h/device + 60/5 min/IP, uniform 401, answer = server_time only); contracts `device-limit-events.ts` + mirror + drift tests; CI/package lists updated. The 29a-2 trigger already turns the event into a notification. pgTAP `20_limit_reached` (30). contracts 360, Deno 227 green; pgTAP pending CI.
- **29c** — Notification preferences on `/settings`: `lib/notifications/preferences.ts` (labels, `preferenceRows`: never stored = on; always-on types read as on and get no control), `setPreference` service (validation → user → rate limit → RPC; 22023 → 'always on' text), `setPreferenceAction` and `PreferencesCard` (one plain form per row). A failed read shows 'could not be read', never 'on'. web 717 tests, typecheck, lint green.
- **29b** — `/notifications`: `lib/notifications/{notifications,queries,service,actions}.ts` + `NotificationList` (plain forms with Server Actions, no client JS). SELECT-only list (`?limit=` 30–150, +30, one extra row for 'more'), head-count of unread; `markRead` = validation → verified user → own rate limit (`NOTIFICATIONS.write` 60/5 min) → RPC `parent_mark_notifications_read` (null ids = all); fixed text per type, only device name + a permission label are filled in, raw metadata never rendered; unread badge (`9+`) in the sidebar and mobile drawer via `loadUnreadCount` in the (app) layout and the dashboard Alerts card now real — **both swallow failures (null) so a broken count never breaks a page**; shows '—' not '0' when unreadable. 701 web tests, typecheck, lint, build green.
- **29a-2** — Migration `20261007000500_notification_producers.sql`: producers are AFTER INSERT triggers on `device_events` (offline, battery low, blocked-app attempt, geofence enter/exit, limit reached, 'was GRANTED, now DENIED/REVOKED/RESTRICTED' → PERMISSION_REVOKED with the permission key only) and `audit_logs` (DEVICE_ENROLLED; DEVICE_REMOVED with reason credential_reuse → SECURITY_EVENT) — **no existing writer function changed**; internal `notify_parent` (execute revoked from everyone): owner via device→child→family, preference check, per-type dedupe windows (offline 30 min, battery 6 h, blocked app 10 min, permission 1 h, limit 1 h, others none), ≤ 500 per parent. **EMERGENCY and SECURITY_EVENT are always on** (`parent_set_notification_preference` re-created: 22023; stored 'off' ignored). Contracts: `NOTIFICATION_ALWAYS_ON`, `NOTIFICATION_DEDUPE_MINUTES` + SQL drift tests; pgTAP `19_notification_producers` (35), `18` adapted. Metadata never holds package names/labels/coordinates.
- **29a-1** — Migration `20261007000400_notifications.sql`: `notifications` (type CHECK = the ten §49 types, device optional/cascade, metadata ≤ 2 KB object, `read_at ≥ created_at`, indexes incl. unread + retention) and `notification_preferences` (absent = enabled); RLS select-own only (no write grants); RPCs `parent_mark_notifications_read(ids|null, ≤ 200)` and `parent_set_notification_preference` ('updated'|'unchanged'); `notifications_purge_expired` (90 d, service_role). Contracts `notifications.ts` + SQL drift test (types, limits, grants). `01_schema` table list + allow-list updated; pgTAP `18_notifications` (60). Producers + dedupe + per-parent cap = 29a-2.
- **30b** — `/audit-logs`: `lib/audit/{audit,queries}.ts` + `AuditList` (plain GET form, no client JS) + page. Calls only the RPC `parent_list_audit_logs`; filters action (known list) / device / UTC date range (to inclusive → next-day half-open) / keyset cursor `(before_at, before_id)`; page size 25 (+1 row to detect an older page); every bad URL value = no filter (never an error); **metadata read through a whitelist** (fields→labels, method, reason, permission names); IP shown for sign-ins only; unknown actions humanized. Also fixed 30a's CI failure: the `01_schema` allow-list of authenticated-executable functions now contains `parent_list_audit_logs` (new rule 9 in plan.md). Untracked `tsconfig.tsbuildinfo` and ignored `*.tsbuildinfo`. web 670 tests, typecheck, lint, build green.
- **30a** — Migration `20261007000300_audit_log_read.sql`: `parent_list_audit_logs` (own rows, newest first, keyset cursor `(before_at, before_id)`, filters action/device/from/to, limit 1–100 default 50, IP as text, device name, SECURITY DEFINER keyed on `auth.uid()`, 42501 without a session, 22023 on bad input); `parent_set_app_rule` re-created with `APP_BLOCKED`/`APP_UNBLOCKED` audit rows (metadata `{"fields":["blocked"]}` — **field name only, no package**; limit-only changes and no-ops add nothing; clearing a blocked rule = UNBLOCKED); `audit_purge_expired()` (180 d, service_role only; scheduling = 32a). New pgTAP `17_audit_log` (34); `14_app_rules` counts adapted (plan 136). pgTAP pending CI.
- **20c-1** — Activity tab: `lib/activity/{activity,queries}.ts` + `ActivityCard` + page. SELECT-only read of `device_events` via the parent's RLS session, newest first, `?limit=` 10–200 (default 50, 'Show more' +50), one extra row read to know `hasMore`; known types (online/offline/battery low/permission change/app installed|removed/blocked app opened) get readable lines, unknown types a humanized title; **raw metadata never rendered**; app labels looked up only for packages named by the page's events. Commands timeline arrives with M3 (20c-2). web 643 tests, typecheck, lint, build green.
- **19d-1+2** — Legacy bedtime/school-mode removed end to end. Migration `20261007000200_drop_legacy_schedule_columns.sql` (trigger functions + `device_get_config` stop naming the columns, `device_get_config` loses 4 outputs, then 4 columns dropped); seed + pgTAP 02/04/05/06/13/15 adapted (13 plan 94, 02 plan 30; direct-write versioning now exercised with `daily_screen_limit_minutes`); contracts + Edge mirror lose the 4 wire keys (strict: old keys now rejected); Android drift/mapper tests (app already ignored the keys, old servers still tolerated); web `RULES_COLUMNS`, `RulesRow`, rules card and dashboard summary no longer mention them. contracts 321, Deno 214, web 620, JVM 795 green; pgTAP pending CI. **No conversion** of old values (nothing ever created a schedule from them).
- **T4** — Managed-mode visibility, full chain. SQL `20261007000100_managed_mode.sql`: `devices.managed_mode` (nullable, parent read-only) + 6-arg `device_update_info` overload (5-arg untouched; `09` now uses `bool_and` over both overloads); new pgTAP `16_managed_mode` (34 tests, NOT run locally). Contracts + Edge mirror: required `managed_mode` boolean. Android: `DeviceDetails.managedMode` (codec 6 fields, old 5-field = never sent), DTO, source reads the detector, re-upload when it changes; child `EnforcementStatus` shown on Device status ("Managed mode": on/off, paused apps + reason, refused count, release note). Web: `managedMode` on `DeviceRow`, `managedModeText` (always 'reported'), Enforcement row on the device information card. contracts 318, Deno 214, web 621, JVM 795 green; pgTAP pending CI.
- **T3** — Enforcement port: pure `EnforcementPlanner` (priority BLOCKED > APP_LIMIT > DAILY_LIMIT > SCHEDULE; broad cases skip system apps and FamilySafe), `Enforcer` with `ConsumerEnforcer` (inform only) and `ManagedEnforcer` (pauses via `PackageSuspender`; only resumes what it paused; refused packages not retried until they leave the plan; vanished packages dropped), sealed `SuspendedPackagesStore` (codec v1), memory `EnforcementStatusStore`, `EnforcementRunner`, 15-min `EnforcementWorker` scheduled only while managed+enrolled. Triggers: every check spot + background pass `runBackgroundChecks()` (boundary job too); disconnect → `releaseAll`. 792 JVM tests green. **Not run on a device/emulator** (no system image installed); real `setPackagesSuspended` behaviour is unverified.
- **T2** — Device-admin wiring: `admin/FamilySafeAdminReceiver` (no logic), `res/xml/device_admin.xml` (`<uses-policies/>`), one manifest receiver protected by `BIND_DEVICE_ADMIN`; ports `ManagedModeDetector`/`PackageSuspender` + Android adapters (`AndroidManagedMode.kt` is the ONLY file allowed to name DevicePolicyManager/setPackagesSuspended, guard-tested); older 'no receiver' guards now say 'exactly the admin receiver'. No new permission. 762 JVM tests green.
- **T1** — Track B decision recorded in `docs/ANDROID_PERMISSIONS.md`: opt-in Device Owner, `setPackagesSuspended` only (no uninstall block / kiosk / hide), system apps never suspended by total-limit or schedule rules, release everything on disconnect, Play distribution to be verified in 34c. Binding for T2–T4.
- **19c-3** — Android now reads schedules (Track A, informs only). New: `ScheduleStatus` (memory-only), `ScheduleStatusEvaluator`, `QuietTimeNotices` (dismissed per window+day+times), `ScheduleBoundary`, `ScheduleCheckRunner`, one-off `ScheduleBoundaryWorker` (REPLACE, no network, no exact alarm), `QuietTimeScreen`, Device status "Schedules from your parent" section. Triggers: resume, 60 s foreground tick, rules change, boundary job; **decision:** zone/date changes are picked up by those triggers (zone read on every check), no receiver, no new permission/service (guard test). Wording: BEDTIME="Bedtime", SCHOOL="School time", CUSTOM="Quiet time". Web ENFORCEMENT/SCHEDULES notes updated (no more "not applied yet"); versionName 0.19.0. 757 JVM tests + web 618 green.
- **19c-2** — DTO reads `timezone` (nullable) + `schedules`; legacy `bedtime_*`/`school_mode_enabled` no longer read (stay on the wire until 19d-1, ignored via ignoreUnknownKeys); `ScreenTimeConfig` now has `timezone` + `schedules` and no `BedtimeWindow`/school flag; sealed codec **v3** (`v3;validatedAt;version;limit;overrides;timezone;schedules;apps`, schedule names URL-encoded, v2/pre-18c = no cache); `TimezoneName` mirrors the contract; drift tests cover ScheduleDto keys, limits, tz pattern; device-status lines for bedtime/school removed (19c-3 adds schedules display). 731 tests green.
- **19c-1 (2026-10-07)** — `domain/Schedules.kt`: `ScheduleWindow.validated` (mirrors `scheduleSchema`), `ScheduleList.validated` (≤ 20, unique ids, same-type overlap via week ranges), `ScheduleEvaluator.evaluate(windows, zone, instant)` → `ScheduleState(active, nextBoundary)`, `zoneFor(timezone, deviceZone)`. Binding decisions: windows are read as wall-clock times and converted per occurrence (DST gap start moves forward, a window that vanishes in the gap is skipped that day, an ambiguous time takes the earlier offset); active windows carry `startDate` (for 19c-3 "dismiss per window+day"); an unknown/malformed `timezone` falls back to the device zone; BEDTIME/SCHOOL/CUSTOM order is the display order. 726 JVM tests, ktlint, lint, manifest guard green locally.
- **H2a–c (2026-10-07)** — Kotlin compiled unchanged. Fixed test-side defects only: colon in a backticked test name (`AppAttemptHttpMapperTest`), stray `)` (`HeartbeatRunnerTest:40`), `AppAttemptContractDriftTest.serialNames` assumed multi-line DTOs, `AppInventoryContractDriftTest` regex missed `trimmedText(` keys and had 4× backslashes in a raw string, `DeviceConfigContractDriftTest` counted nullables across `AppRuleDto` too (now scoped to `DeviceConfigDataDto`), `DeviceConfigRunnerTest` fixture lacked `app_rules`; reworded a doc comment containing "label" that a guard test bans; ktlintFormat + trailing-comment moves in `build.gradle.kts` and tests. No guard or drift assertion was weakened. CI mirror: all jobs.
- **M0-1 (2026-10-07)** — repo on GitHub (`A-42-018/Family-Safe`, `main`): baseline commit of 19b + plan v2, then CI `deno test` step now covers all 13 functions (was missing `device-usage`, `device-config`, `device-app-events`) and the unused `eslint-disable` in `lib/schedules/schedules.ts` removed (lint 0 warnings). Status ◐ until the first CI run's database + android jobs are read.
- **Plan v2 (2026-10-07)** — ran the web/contracts/Deno toolchains for real (all green, numbers above); H1b ☑, H1a ◐ (pgTAP left). Roadmap regrouped into milestones M0–M8 with demo gates and an MVP cut line; Track B (Device Owner) T1–T4 added; 20c-1, 30a/b, 29a–d, 32a moved earlier; 8 S-sized pairs merged; 33a pulled into M0-2; git + CI made the verification source of truth. No source code changed.
- **Roadmap reset after 19b** — plan.md slimmed, remaining phases split into one-layer sub-phases, verification phases H1/H2 added.
