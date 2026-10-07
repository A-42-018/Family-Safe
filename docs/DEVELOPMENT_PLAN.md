# DEVELOPMENT_PLAN — roadmap briefs

Live status and milestone order (v2): `/plan.md`. Order of the 34 phases: `/prompt.md` §53. History: `docs/PLAN_ARCHIVE.md`.
Read only your own `### <id>` section (`grep -n '^### 21b-3' docs/DEVELOPMENT_PLAN.md`, then `sed -n` to the next `###`).

## Sizing rules
- One sub-phase = one session = one layer (SQL | Edge+contracts | web | Android domain | Android data/work | Android UI | docs | verify-fix).
- Budget: ≤ 1 migration, or ≤ 1 Edge function, or ≤ 1 web page/feature, or ≤ 1 Android slice; about ≤ 8 new source files and ≤ 5 test files. S ≤ 5 files, M ≤ 10. No L: split instead.
- If a session runs long: stop coding, update plan.md, ZIP, and move the rest to `<id>b`.
- Every brief lists: **Goal · Touch · Tests · Done when**. "Decide first" items must be recorded in plan.md (≤ 8 lines).
- Report format per phase: Implemented / Files changed / Database / API / Android / Tests / Known limitations / Next.

---

## v2 additions (2026-10-07) — milestone order lives in `/plan.md`

### M0-1 — Git + CI as verifier [V · S]
**Goal:** `git init`, first commit of the 19b tree, push to a private GitHub repo so `.github/workflows/ci.yml` runs all five jobs (structure, functions, web, database/pgTAP, android). Fix: add `device-usage/ device-config/ device-app-events/` to the CI `deno test` step; remove the unused `eslint-disable` at `apps/web/lib/schedules/schedules.ts:42`.
**Touch:** `ci.yml`, `schedules.ts`, `.gitignore` (confirm `google-services.json`, `.env*`, `local.properties` ignored).
**Done when:** structure/functions/web jobs green; database + android job results recorded in plan.md (failures feed H1a / H2a).

### M0-2 — Walking skeleton [V · M]
**Goal:** first full run on `supabase start` + `functions serve` + `npm run dev:web` + emulator (API 34+, base URL `10.0.2.2`). Script: sign up (Inbucket) → create child → Add device code → enroll emulator → heartbeat, device info, permissions, apps, usage appear → set a daily limit → device-config pulled (ETag) → revoke → device shows disconnected.
**Touch:** only defects found; write `docs/DEMO.md` (steps + expected screens).
**Done when:** every step passes or each failure is a listed fix task.

### T1 — Track B decision [DOC · S]
**Goal:** in `ANDROID_PERMISSIONS.md`: Device Owner provisioning for test/demo (`adb shell dpm set-device-owner app.familysafe.child/.admin.FamilySafeAdminReceiver` on a fresh emulator without accounts) vs enterprise (QR/zero-touch); capability matrix (`setPackagesSuspended`, `setUninstallBlocked` NOT used, lock task NOT used); Play distribution notes; what stays Track A.
**Done when:** decision recorded in plan.md (≤ 8 lines).

### T2 — Device admin wiring [A-DATA · M]
**Goal:** `FamilySafeAdminReceiver` (exported only with `android:permission="android.permission.BIND_DEVICE_ADMIN"`), `res/xml/device_admin.xml`, `ManagedModeDetector` (`isDeviceOwnerApp`), `PackageSuspender` interface + DPM impl + fake. Manifest guard allow-list updated in the same change with a test proving the receiver is permission-protected.
**Done when:** build + manifest guard + unit tests green.

### T3 — Enforcement port [A-DOM+DATA · M]
**Goal:** `EnforcementPort` with Track A (existing notice) and Track B (suspend BLOCKED / over-LIMIT packages and, during schedule windows, all non-allow-listed packages; never suspend FamilySafe, dialer, settings). Reconcile on every evaluation; unsuspend everything on rule removal, disconnect and revoke.
**Tests:** reconcile diff, never-suspend list, disconnect unsuspends all, Track A unchanged.

### T4 — Managed-mode visibility [A-UI+WEB · S]
**Goal:** child Device status shows "Managed mode: apps can be paused by your parent"; heartbeat/device-info reports `managed_mode` (contracts + mirror + drift in the same chain, or reuse device-info if a field exists); web overview badge "Managed (enforces)" vs "Standard (informs)".

---

## H — Verification (fix-only; no new features)

### H1a — Backend toolchains [V · M]
**Goal:** run what was never run and fix test-only defects. Commands (you run locally, paste only failing output): `scripts/db/verify.sh` (first real run of `15_schedules`), `npm run test:contracts`, `npm run test:functions`, `npm run check`.
**Touch:** failing test files only; production code only if a real defect is proven.
**Done when:** pgTAP, contracts, Deno green or each failure is listed with a reason. Record real totals in plan.md.

### H1b — Web toolchain [V · M]
**Goal:** `npm ci && npm run typecheck && npm run lint && npm run test:web && npm run build:web`; fix typing/lint/test defects from 16c-1 to 19b (known suspects are listed in the archive under each phase's "likeliest first-run fixes").
**Done when:** all five commands green; web test total recorded.

### H2a — First Gradle compile [V · M]
**Goal:** `cd apps/android && ./gradlew assembleDebug`; fix compile errors only, in the order Gradle reports them. Paste the first ~40 error lines per session.
**Done when:** `assembleDebug` succeeds, or the remaining errors are listed for H2a-b.

### H2b — JVM unit + drift tests [V · M]
**Goal:** `./gradlew testDebugUnitTest`; fix test defects (Turbine timing, MockEngine, drift regexes). Never weaken a drift/guard test to pass; fix the cause.
**Done when:** all unit tests green; count recorded.

### H2c — ktlint, lint, manifest guard [V · S]
**Goal:** `ktlintFormat` then `ktlintCheck lintDebug verifyDebugManifestPermissions`.
**Done when:** all green; manifest permission set unchanged.

---

## 19 — Schedules, Android + legacy cleanup

### 19c-1 — Schedule domain + evaluator [A-DOM · M]
**Goal:** pure `ScheduleConfig` (id, name, type, days ISO, start/end `HH:MM`) and an evaluator: is a window active at an instant, and when is the next boundary. Semantics: ISO weekday, overnight belongs to its start day, Sunday wraps to Monday, half-open, zone = config `timezone` or the device zone.
**Touch:** `domain/` new file(s); tests only. No DTO, UI, worker.
**Tests:** DST spring/fall, zone change, date change, midnight cross, Sunday wrap, back-to-back windows, two types overlapping, empty list.
**Done when:** JVM tests green (or written + unexecuted if H2 not done).

### 19c-2 — Schedule config wire + cache [A-DATA · M]
**Goal:** `DeviceConfigDtos` reads `timezone` (nullable) and `schedules`; `ScreenTimeConfig` + sealed codec v3 (v2 strings read as no cache); remove the drift-test exclusion; stop reading legacy `bedtime_*`/`school_mode_enabled` (they stay on the wire until 19d; `ignoreUnknownKeys` covers them).
**Touch:** `DeviceConfig*`, `ScreenTimeConfig*`, drift test, store tests.
**Done when:** Rejected on off-contract schedules; round-trip and junk tests pass.

### 19c-3 — Evaluation triggers + quiet-time UI [A-UI · M]
**Goal:** evaluate on resume, config change, 1-min foreground tick; schedule one-off WorkManager at the next boundary (no exact-alarm permission); re-evaluate on time-zone/date change (runtime-registered receiver or resume — decide first, no new manifest receiver unless exempt and guard-tested). Child-visible "quiet time" notice + Device status section; strings; web copy "does not apply schedules yet" updated in the same change.
**Decide first:** BEDTIME vs SCHOOL wording; notice dismissable per window+day.
**Done when:** guard test: no new permission/service; copy still says the app cannot lock the phone.

### 19d-1 — Drop legacy columns [SQL+EDGE · S]
**Goal:** one migration dropping `device_rules.bedtime_*`/`school_mode_enabled`, removing them from the version trigger, `device_get_config`, `device-config` Edge, contracts and mirror; update pgTAP 13/15 and drift tests.
**Done when:** `verify.sh`, contracts, Deno green.

### 19d-2 — Web legacy removal [WEB · S]
**Goal:** remove read-only bedtime/school display from the rules tab and dashboard summary; point to Schedules. Update tests.

---

## 20 — FCM command sync

### 20a-1 — Command SQL [SQL · M]
**Goal:** `device_register_push_token(device, token)` (upsert `device_tokens`; token never granted to parents), `device_commands_pull(device)` (PENDING → DELIVERED, unexpired, known types only), `device_command_ack(device, cmd, status)` (state machine, replay-safe), `parent_send_command(device, type)` (allow-list: `SYNC_CONFIG`; audit `DEVICE_COMMAND_SENT`), expiry sweep fn.
**Decide first:** read receipt — add `applied_config_version` on ack? If yes, add column + web display in 20c-1.
**Tests:** pgTAP (privileges, replay, expiry, foreign ≙ missing, revoked device refused).

### 20a-2 — Command Edge [EDGE · M]
**Goal:** `device-fcm-token` (POST) and `device-commands` (GET list, POST ack) with `requireActiveDevice`, strict bodies, limits; contracts + mirror + drift tests.
**Tests:** Deno handlers (uniform 401, strict body, limits, log hygiene), contracts drift vs SQL.

### 20a-3 — FCM sender [EDGE · M]
**Goal:** `_shared/fcm.ts` (HTTP v1; service-account OAuth via Web Crypto; credentials only as Edge secret) and an internal dispatch path that sends `{type:"SYNC", cmd_id}` only.
**Decide first:** trigger mechanism (Database Webhook / pg_net vs a scheduled drain); document in plan.md.
**Tests:** fake FCM: payload has no data, invalid-token cleanup, failure leaves command PENDING, secret never logged.

### 20b-1 — Firebase wiring [A-DATA · S]
**Goal:** add `firebase-messaging` (pinned), `google-services` handling with `google-services.json` gitignored and a CI placeholder, non-exported `FirebaseMessagingService`. No token upload yet.
**Precondition:** H2 finished (first real build).
**Done when:** build + manifest guard green; allow-list unchanged unless a permission is truly needed.

### 20b-2 — Token registration [A-DATA · M]
**Goal:** `FcmTokenRepository`/runner/worker: register after enrollment and on `onNewToken`; standard outcome mapping; drift test vs contracts.

### 20b-3 — Command executor [A-DATA · M]
**Goal:** FCM message only enqueues a unique one-off pull; pull via `device-commands`, validate type (never trust the FCM payload), execute `SYNC_CONFIG` (→ `device-config-now`), ack; periodic fallback pull when FCM is unavailable; dedupe by command id.
**Tests:** duplicate/expired commands, unknown type, ack retry.

### 20c-1 — Activity tab [WEB · M]
**Goal:** `/devices/[id]/activity`: timeline of `device_events` (incl. `BLOCKED_APP_ATTEMPT`, permission changes, app installs) and `device_commands` with status; "device applied vN" if 20a-1 added it. Read-only, paginated by limit.

### 20c-2 — Send command [WEB · S]
**Goal:** "Refresh device now" action via `parent_send_command`; rate limit; generic outcome mapping; copy says it is a wake-up, not a guarantee.

---

## 21 — Location

### 21a-1 — Settings SQL [SQL · M]
**Goal:** `parent_set_location_settings(device, enabled, history_enabled)` (audit `LOCATION_SETTINGS_CHANGED`, field names only); extend the 17a version triggers and `device_get_config` with the location toggles (version bump + `SYNC_CONFIG`); CHECKs already tie history to enabled.
**Tests:** pgTAP incl. config payload shape and that `05_rls` stays green.

### 21a-2 — Ingest + audited read SQL [SQL · M]
**Goal:** `device_upload_location(device, points)` (bounds, batch cap, ignored when disabled server-side, monotonic time window); latest-location column or query; `parent_get_latest_location(device)` writing `LOCATION_VIEWED`. **Decide first:** revoke parent direct SELECT on `location_points` (closes the audit gap noted in Phase 4) and adjust `05_rls`.
**Tests:** pgTAP incl. audit row per read, foreign ≙ missing, disabled device.

### 21a-3 — Location Edge + contracts [EDGE · M]
**Goal:** `device-location` (strict body, ≤ N points, limits), `device-config` passes location toggles; contracts + mirror + drift tests.

### 21b-1 — Foreground location permission [A-UI · M]
**Goal:** request `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` from the Permissions screen (rationale, `markRequested` before the prompt, per-state copy); manifest + allow-list + guard tests in the same change. No collection yet.

### 21b-2 — Location config + policy [A-DOM · M]
**Goal:** read location toggles (codec v4); pure policy: collect only when parent enabled AND OS granted AND not disconnected.

### 21b-3 — Collector + upload [A-DATA · M]
**Goal:** `FusedLocationProviderClient` (pinned play-services-location) one-shot/balanced requests; sealed outbox (capped, oldest dropped); batch worker; standard outcome mapping; drift test vs contracts; no logging of coordinates.
**Decide first:** background collection needs `ACCESS_BACKGROUND_LOCATION` (21b-4) — until then collect only while the app is open.

### 21b-4 — Background location disclosure [A-UI · M]
**Goal:** separate prominent-disclosure screen, then the background permission step (Android 11+ settings flow); child-visible "location sharing is on/off, last sent, what is sent"; manifest + allow-list + Play declaration notes (feeds 34c).

### 21c-1 — Location page (no map) [WEB · M]
**Goal:** `/devices/[id]/location`: enable/disable with consent copy ("nothing is collected until the child grants permission"), latest location as text (coordinates, accuracy, age) via the audited RPC. **No coordinates in URLs.**

### 21c-2 — Map provider [WEB · M]
**Goal:** `MapProvider` interface + one implementation + marker on the location page; CSP updated. **Decide first (research with web search):** provider, pricing/licensing, tile hosts, no third-party tracking of coordinates beyond the tile request; record in plan.md.

---

## 22 — Location history

### 22a — History SQL [SQL · M]
**Goal:** per-device `location_retention_days` (7/30/90), `parent_get_location_history(device, from, to, limit)` audited (`LOCATION_VIEWED`, range only in metadata), `parent_delete_location_history`, `location_purge_expired()` (scheduling = 32a).

### 22b — History web [WEB · M]
**Goal:** history list on the location page (GET-form date range, limit, downsample note), delete with confirm dialog, retention selector.

### 22c — Track on map [WEB · S]
**Goal:** polyline/points via `MapProvider`; accessible text alternative.

### 22d — Adaptive intervals [A-DOM+DATA · M]
**Goal:** pure interval policy (moving/still/low battery), history gating (store history only when `location_history_enabled`; otherwise latest only), batching; battery-friendly (no 1-s polling).

---

## 23 — Geofencing

### 23a-1 — Geofence RPCs [SQL · M]
**Goal:** `parent_save_geofence`/`parent_delete_geofence` (lat/lon bounds, radius ≥ 100 m, cap ≤ 20, name rules), versioning into `device_get_config`, audit field names only.

### 23a-2 — Event ingest [SQL · M]
**Goal:** `device_record_geofence_events(device, events)`: validate geofence belongs to device, dedupe, window, write `geofence_events` + `device_events` (`GEOFENCE_ENTER/EXIT`).

### 23a-3 — Geofence Edge [EDGE · M]
**Goal:** `device-geofence-events`; `device-config` passes `geofences`; contracts + mirror + drift tests.

### 23b-1 — Geofence list/editor [WEB · M]
**Goal:** `/devices/[id]/geofences`: numeric form (name, lat, lon, radius), list, enable toggle, events list.

### 23b-2 — Map picker [WEB · S]
**Goal:** place/drag a circle with `MapProvider`; form stays usable without JS.

### 23c-1 — Geofence config + policy [A-DOM · M]
**Goal:** codec v5 with geofences; pure register-diff (add/remove, ≤ 100 per app) and event dedupe.

### 23c-2 — GeofencingClient [A-DATA · M]
**Goal:** register/unregister, non-exported receiver with correct PendingIntent flags, re-register after reboot and config change; needs background location (21b-4).

### 23c-3 — Event upload + transparency [A-DATA+UI · M]
**Goal:** sealed outbox, upload, child-visible "places your parent set" list.

---

## 24 — Emergency

### 24a-1 — Alerts SQL [SQL · M]
**Goal:** `emergency_alerts` (device, time, battery, network, optional location point, status NEW/ACKNOWLEDGED), RLS select for owner, `parent_ack_emergency`, rate cap per device.

### 24a-2 — Emergency Edge [EDGE · M]
**Goal:** `device-emergency` (strict body, own limiter, idempotency key), contracts + mirror + drift tests.

### 24b-1 — Send path [A-DATA · M]
**Goal:** repository/runner/worker with sealed outbox and retry; location snapshot only if permission granted and enabled; no camera, no microphone.

### 24b-2 — Safety screen [A-UI · S]
**Goal:** emergency button (press-and-hold confirm), clear result text ("sent" / "will retry"), copy states what is sent.

### 24c — Alerts web [WEB · M]
**Goal:** dashboard Alerts card (real count), alert list with location via audited RPC, acknowledge action. Push/email later (29).

---

## 25 — Safety contacts (no contacts permission)

### 25a-1 — Contacts SQL [SQL · M]
**Goal:** `safety_contacts` (name, phone E.164-ish check, relation), cap ≤ 10, parent RPCs, versioning. **Decision recorded:** `READ_CONTACTS` is not requested; parent-entered contacts are shown on the child device and dialed through `ACTION_DIAL`.

### 25a-2 — Contacts Edge [EDGE · S]
**Goal:** pass-through in `device-config`; contracts + mirror + drift.

### 25b — Contacts editor [WEB · M]
**Goal:** list/add/edit/delete form with generic outcome mapping.

### 25c — Contacts on device [A-UI · M]
**Goal:** codec bump, Safety screen list with "Call" via `ACTION_DIAL` (no permission), transparency text.

---

## 26 — SMS / call log (assessment, compliant states)

### 26a — Assessment [DOC · S]
**Goal:** per §46/§58 for SMS, call log, phone state: Android API, Play policy, default-handler rule, alternatives, Track B notes. Result in `ANDROID_PERMISSIONS.md`. No bypass, no accessibility/notification scraping.

### 26b — Unavailable states [WEB+A-UI · S]
**Goal:** card/screen text "Feature unavailable under current Android/Play distribution requirements" with the compliant alternative (safety contacts, emergency button).

---

## 27 — Camera (enrollment only)

### 27a — QR image [WEB · S]
**Goal:** render the pairing payload as QR (inline SVG, CSP-safe) in the Add device dialog; code stays in component state only. **Decide first:** small QR library vs own encoder.

### 27b-1 — Scanner [A-DATA · M]
**Goal:** prefer Google code scanner (no `CAMERA` permission) if viable; else CameraX + ML Kit with `CAMERA` in manifest + allow-list + copy. Record the decision.

### 27b-2 — Enrollment wiring [A-UI · M]
**Goal:** scan → fill code → existing confirm-before-connect screen. No deep link, no hidden camera use.

---

## 28 — Microphone

### 28a — Assessment + go/no-go [DOC · S]
**Goal:** document what is permitted (user-initiated audio, emergency communication); no ambient/background recording. Decide whether 28b–28e (child-initiated voice note) are built.

### 28b–28e — Voice note [opt · M×4]
28b SQL + private storage bucket + short retention · 28c Edge signed upload URL · 28d Android recorder (foreground, visible, user-initiated, `RECORD_AUDIO` + allow-list + copy) · 28e web playback with audited access.

---

## 29 — Parent notifications

### 29a-1 — Notification tables [SQL · M]
**Goal:** `notifications` (type, device, minimal metadata, read_at), `notification_preferences`, RLS, `mark_read` RPC.

### 29a-2 — Producers [SQL · M]
**Goal:** triggers create notifications for offline, battery low, emergency, geofence, permission revoked, blocked-app attempt, enrollment, security event, respecting preferences; dedupe window.

### 29b — Notifications page [WEB · M]
**Goal:** `/notifications` list, unread badge in the shell, dashboard Alerts card wired.

### 29c — Preferences [WEB · S]
**Goal:** per-type toggles under `/settings`.

### 29d-1 — Limit-reached event backend [SQL+EDGE · S]
**Goal:** new event type through the device events path (package-free), throttled; contracts + mirror.

### 29d-2 — Limit-reached upload [A-DATA · S]
**Goal:** outbox + upload from the existing limit check; transparency text.

### 29e / 29f — Email / web push [opt · M]
**Goal:** delivery channels behind the same preferences. **Decide first:** provider, secrets as Edge secrets only, no sensitive content in the message body.

---

## 30 — Audit logs

### 30a — Audit SQL [SQL · M]
**Goal:** `parent_list_audit_logs(filters, cursor)`, add `APP_BLOCKED`/`APP_UNBLOCKED` from the app-rule path (field names only), 180-day purge fn.

### 30b — Audit page [WEB · M]
**Goal:** `/audit-logs` with action/date filters and cursor paging; no sensitive metadata rendered.

### 30c — Coverage tests [SQL · S]
**Goal:** tests proving every sensitive read/write in the §39 list writes an audit row.

---

## 31 — Security hardening

### 31a-1 — Shared limiter store [SQL · M]
**Goal:** `rate_limit_hit(key, window, max)`; atomic, no PII in keys (hashed).

### 31a-2 — Edge limiter swap [EDGE · S]
**Goal:** replace the in-memory limiter behind the existing interface; failure mode decided (fail closed for auth endpoints).

### 31a-3 — Web limiter swap [WEB · S]
**Goal:** same for `lib/security/ratelimit.ts`.

### 31b-1 — Device session cap [SQL+EDGE · S]
**Goal:** absolute refresh-chain lifetime; expiry → `Expired` on the device.

### 31b-2 — Parent session hardening [WEB · M]
**Goal:** "log out everywhere" UI, `requireAal2` on sensitive actions (decide list), signed server-to-server channel for audit IP.

### 31c — Dependencies + CI + CSP [DOC+CI · M]
**Goal:** `npm audit` triage, Gradle dependency verification, CSP review, secret-scan gate, CI jobs required.

### 31d — Android hardening [A-DATA · M]
**Goal:** exported-component audit, backup rules, R8 log stripping check, network security config decision (pinning: decide and document), StrictMode in debug.

### 31e-1 — DB/Edge security tests [SQL+EDGE · M]
**Goal:** generic matrix: every RPC rejects `anon`; cross-family IDOR; JWT tamper; token replay; command replay; pairing brute force.

### 31e-2 — Web security tests [WEB · M]
**Goal:** XSS/CSRF/open-redirect/log-leak guards across pages and actions.

---

## 32 — Privacy and retention

### 32a — Retention jobs [SQL · M]
**Goal:** purge functions for location (7/30/90), usage 90 d, audit 180 d, events, rotated credentials, consumed pairing tokens; one `retention_run()`; schedule (pg_cron or scheduled Edge) and the stale-offline sweep.

### 32b — Removal + delete-data [SQL · M]
**Goal:** hard device removal (cascade, audit) and "delete all history" RPCs for a device/child.

### 32c — Privacy settings [WEB · M]
**Goal:** retention selectors, delete controls with confirm, "what is stored" page.

### 32d — Child data screen [A-UI · M]
**Goal:** consolidated "what is shared" page, local wipe of every sealed store on disconnect/removal.

### 32e — Privacy docs [DOC · S]
**Goal:** one consolidated `PRIVACY.md`, data-safety mapping, draft policy text.

---

## 33 — Integration testing

### 33a — Smoke script [V · S]
**Goal:** documented `curl` flow on `supabase start`: enroll → refresh → heartbeat → config → revoke.

### 33b — Web E2E [V · M]
**Goal:** browser tests (tool decision recorded): login, add child, add device, rules, schedules, applications.

### 33c — Android tests [V · M]
**Goal:** instrumented tests (Keystore store, WorkManager) + manual matrix from §50 (reboot, process kill, doze, time-zone change, offline, FCM off).

### 33d — Security run [V · S]
**Goal:** execute 31e suites, write findings.

### 33e — Reserve [V · M×2]
**Goal:** fix batches from 33a–33d.

---

## 34 — Production prep

### 34a — Deployment [DOC · M]
**Goal:** environments, secrets list, migration pipeline with approval, monitoring without sensitive data, backups.

### 34b — Android release [A-DATA · M]
**Goal:** signing config via CI secrets (none in repo), R8 verification, version policy.

### 34c — Play + Track B [DOC · M]
**Goal:** data-safety answers, permission declarations (background location, Usage Access), Track A vs Track B (Device Owner/managed) notes.

### 34d — Runbook + docs sweep [DOC · M]
**Goal:** incident, key rotation, revoke-all, FCM credential rotation; final sweep of README/ARCHITECTURE/API.

### 34e — RC regression [V · S]
**Goal:** run all suites and the smoke script; tag the release candidate.
