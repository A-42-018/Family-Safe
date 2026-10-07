# plan.md — Living Plan (compact, v2)

Full history of Phases 1–19b: `docs/PLAN_ARCHIVE.md` (grep it, never read it whole). Roadmap briefs: `docs/DEVELOPMENT_PLAN.md` (read only your own `### <id>` section; new M0/T-briefs are at its top). Master requirements: `prompt.md`.

## Current status
**Last finished:** 19b — Schedules, web. **Plan v2 (2026-10-07):** roadmap regrouped into 9 demoable milestones (M0–M8), ~85 sessions in total (8 merges offset by 6 new), MVP reachable in ~36. No source code changed.
**Next step:** **M0-1 — put the repo in git + GitHub so CI runs pgTAP and Gradle** (CI already defines both jobs), then H2a.

## Verified 2026-10-07 (real toolchains, macOS, Node 22.12, Deno 2.9.6)
| Check | Result |
|---|---|
| `npm run check` | ✅ structure + secrets OK |
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 1 warning (unused `eslint-disable` in `apps/web/lib/schedules/schedules.ts:42`) |
| `npm run test:contracts` | ✅ 312 / 312 (11 files) |
| `npm run test:web` | ✅ 618 / 618 (39 files) |
| `npm run build:web` | ✅ 29 routes |
| `npm run test:functions` (Deno) | ✅ 214 / 214 |
| `deno check */index.ts` | ✅ all 13 functions |
| pgTAP `scripts/db/verify.sh` | ☐ not run (no Postgres/pgTAP locally) |
| Gradle (assemble, unit, ktlint, lint, manifest guard) | ☐ not run (no Android SDK locally) |
→ **H1b is done.** H1a is done except pgTAP. **Kotlin (9b–19b, ~8.1k main + ~9.2k test LOC) has still never compiled — the #1 project risk.**

## Session rules (how every sub-phase is sized)
1. One sub-phase = one session = ONE layer: SQL | Edge+contracts | web | Android-domain | Android-data/work | Android-UI | docs | verify-fix. **Exception (v2):** two S-sized sub-phases of the same feature may share a session when listed as `a+b` in the roadmap.
2. Budget: ≤ 1 migration OR ≤ 1 Edge function OR ≤ 1 web page/feature OR ≤ 1 Android slice; about ≤ 8 new source files + ≤ 5 test files. Android never mixes domain + data + UI in one session.
3. Start: read this file + your `### <id>` brief + only the files the brief names under *Touch*. Do not open PLAN_ARCHIVE or unrelated docs.
4. Docs: touch only docs whose facts changed, ≤ 10 lines each; the last sub-phase of a feature does the doc sweep.
5. plan.md update after each sub-phase: status line + ≤ 12-line phase-log entry + ≤ 8 lines of decisions that bind later phases.
6. **Verification (v2):** a sub-phase is ☑ only when the CI job for its layer is green (web / functions / database / android). If it could not be run, mark it ◐ ("code complete, unverified") — never ☑. No more than **2 ◐ sub-phases in a row** on the same layer; the next session is then a verify-fix.
7. Checkpoint: finish the files of the current step, update plan.md, then commit (and build the ZIP). If the session is getting long, STOP coding early, split the rest into `<id>b`.
8. ZIP = the whole project + plan.md, no secrets, no `node_modules`/build output, ONE file. **Git is the source of truth; the ZIP is a hand-off copy.** One commit per sub-phase: `<id>: <scope>`.
9. New file → add to `scripts/check-structure.mjs` list. New permission → manifest + allow-list + Permissions copy + child transparency text in the same change. New wire field → contracts + Edge mirror + drift test (+ Kotlin drift test) in the same sub-phase chain. **New Edge function → add it to both `deno check` and `deno test` lists in `package.json` and `ci.yml`.**
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
Read receipt ("device applied vN") → 20a-1 · limit-reached event → 29d · legacy `bedtime_*`/`school_mode_enabled` → 19d · offline sweep → 32a · in-memory limiters → 31a · no QR image → 27a · no self-service unenroll → 32d · refresh expiry slides forever → 31b-1 · audit IP is web-supplied → 31b-2 · CI `deno test` list misses `device-usage`, `device-config`, `device-app-events` → M0-1.

## Roadmap v2 — milestones
Each milestone is a vertical, demoable slice. Sub-phase IDs and briefs are unchanged from v1 unless marked **NEW** or **merged** (`a+b` = one session). Layer: V · SQL · EDGE · WEB · A-DOM · A-DATA · A-UI · DOC. Status: ☐ todo · ◐ code complete, unverified · ☑ verified.

### MVP cut line
**M0–M2 + M4-core + 24 (emergency) = submission-ready product** (~36 sessions). M3, the rest of M4/M5, M6–M8 are stretch / production-prep in that order. If time is short, cut from the bottom of the list, never from M0.

### M0 — Make it real: verify + first end-to-end run (≈ 6 sessions)
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| H1b | V | npm ci, typecheck, lint, vitest, next build | M | ☑ 2026-10-07 |
| H1a | V | contracts ☑ + Deno ☑ done; **pgTAP remains** (via CI or local Postgres+pgTAP) | S | ◐ |
| M0-1 | V | **NEW** git init + GitHub + push; fix CI Deno test list; fix lint warning; CI 5 jobs visible | S | ☐ |
| H2a | V | first Gradle compile; fix compile errors (may need H2a-b, H2a-c) | M | ☐ |
| H2b | V | JVM unit + drift tests | M | ☐ |
| H2c | V | ktlint, Android lint, manifest guard | S | ☐ |
| M0-2 | V | **NEW** walking skeleton on local stack (pulls 33a forward): `supabase start` → sign up → child → pairing code → emulator enrolls → heartbeat/device info/apps/usage visible on web → set a limit → device pulls config | M | ☐ |
**Demo:** the M0-2 script, recorded as `docs/DEMO.md`. **CI must be fully green before M1.**

### M1 — Screen-time core complete + real enforcement option (≈ 8 sessions)
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| 19c-1 | A-DOM | `ScheduleConfig` + pure evaluator + DST/zone tests | M | ☐ |
| 19c-2 | A-DATA | DTO `timezone`/`schedules`; codec v3; drop drift exclusion | M | ☐ |
| 19c-3 | A-UI | triggers, WorkManager re-eval, quiet-time state, copy | M | ☐ |
| 19d-1+2 | SQL+EDGE / WEB | **merged** drop legacy columns + remove web legacy display | S+S | ☐ |
| T1 | DOC | **NEW** Track B decision: Device Owner via `adb shell dpm set-device-owner` (test/demo + enterprise only), capability matrix, what stays Track A | S | ☐ |
| T2 | A-DATA | **NEW** `DeviceAdminReceiver` (BIND_DEVICE_ADMIN), `ManagedModeDetector`, DPM adapter interface (fake in tests); manifest guard updated deliberately | M | ☐ |
| T3 | A-DOM+DATA | **NEW** enforcement port: Track A = notice (existing), Track B = `setPackagesSuspended` for BLOCKED/LIMIT apps + schedule windows; unsuspend on rule removal/disconnect | M | ☐ |
| T4 | A-UI+WEB | **NEW** "Managed mode" on child Device status + web device overview badge; copy distinguishes inform vs enforce | S | ☐ |
**Demo:** create bedtime schedule on web → emulator shows quiet-time notice; on a Device-Owner emulator a blocked app is actually suspended.

### M2 — Parent visibility from data that already exists (≈ 9 sessions)
Fills 3 of the 5 placeholder pages without any new device work.
| ID | Layer | Scope | Size | Status |
|---|---|---|---|---|
| 20c-1 | WEB | activity tab: `device_events` timeline (commands added after M3) — **moved before FCM** | M | ☐ |
| 30a | SQL | audit list RPC, APP_BLOCKED/UNBLOCKED, 180 d purge fn | M | ☐ |
| 30b | WEB | `/audit-logs` page | M | ☐ |
| 29a-1 | SQL | notifications + preferences tables, RLS, RPC | M | ☐ |
| 29a-2 | SQL | producers (offline, battery low, permission revoked, blocked-app attempt, enrollment, security event) | M | ☐ |
| 29b | WEB | `/notifications` list + unread badge + dashboard Alerts card | M | ☐ |
| 29c | WEB | preferences UI | S | ☐ |
| 29d-1+2 | SQL+EDGE / A-DATA | **merged** limit-reached event + upload | S+S | ☐ |
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
- **Plan v2 (2026-10-07)** — ran the web/contracts/Deno toolchains for real (all green, numbers above); H1b ☑, H1a ◐ (pgTAP left). Roadmap regrouped into milestones M0–M8 with demo gates and an MVP cut line; Track B (Device Owner) T1–T4 added; 20c-1, 30a/b, 29a–d, 32a moved earlier; 8 S-sized pairs merged; 33a pulled into M0-2; git + CI made the verification source of truth. No source code changed.
- **Roadmap reset after 19b** — plan.md slimmed, remaining phases split into one-layer sub-phases, verification phases H1/H2 added.
