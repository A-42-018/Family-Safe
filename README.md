# FamilySafe

Transparent, consent-based parental-control and family-safety platform: Parent Web Dashboard (Next.js) · Child Android app (Kotlin) · Supabase backend (Postgres + RLS + Edge Functions) · FCM wake-up signals.

**Principles:** enrolled devices only · visible to the child · no stealth · no permission bypass · least data · short retention · server-authoritative rules, device-enforced.

## Layout
```
apps/web            Next.js parent dashboard
apps/android        Kotlin child app (Phase 10: Compose shell, typed-code enrollment via Ktor; build: `cd apps/android && ./gradlew assembleDebug testDebugUnitTest ktlintCheck lintDebug verifyDebugManifestPermissions`)
supabase/           migrations, edge functions, tests
packages/contracts  shared Zod schemas / API types
docs/               architecture & policy docs
prompt.md           master requirements (verbatim)
plan.md             living phase plan
```
## Status
See `plan.md` (v2, milestones M0–M8). Last finished: Phase 19b. Web, contracts and Deno verified green on real toolchains 2026-10-07; pgTAP and Kotlin still unverified. Next: M0-1 (git + CI), then H2a–c and the M0-2 end-to-end walking skeleton. Briefs: `docs/DEVELOPMENT_PLAN.md`; history: `docs/PLAN_ARCHIVE.md`.

## Local dev
```
cp .env.example .env   # + supabase/functions/.env.example -> supabase/functions/.env
supabase start
supabase functions serve --env-file supabase/functions/.env
curl http://127.0.0.1:54321/functions/v1/health
# web: copy `supabase status` values (API URL, anon key) into apps/web/.env.local (see .env.local.example)
npm run dev:web        # http://localhost:3000 — sign-up emails appear in Inbucket (http://127.0.0.1:54324)
```
## Docs
ARCHITECTURE · DATABASE · API · SECURITY · PRIVACY · ANDROID_PERMISSIONS · DEVELOPMENT_PLAN (all in `docs/`).

- **Phase 16c-1** — `/devices/[id]/usage`: 7-day screen-time chart (CSS bars, no JS), selected-day per-app list. 
- **Phase 16c-2** — dashboard "Today's screen time" card: sum of each enrolled device's current day, with "N of M devices reported" and the device-date caveat.
- **Phase 17a** — screen-time rules backend: `device_rules.daily_limit_overrides` + `config_version`, RPC `parent_set_screen_time_rules`, versioned `device-config` Edge (ETag/304), `SYNC_CONFIG` command + `RULE_CHANGED` audit on change.
- **Phase 17b** — screen-time rules web: `/devices/[id]/rules` (current limits + editor: default daily limit, seven weekday overrides) saving through RPC `parent_set_screen_time_rules` from a Server Action; dashboard "Active restrictions" card (enrolled devices with a limit, bedtime or school mode set).
- **Phase 18b** — app restrictions web: per-app Block / Set limit / Remove on `/devices/[id]/applications` (Server Action → RPC `parent_set_app_rule`), restriction badges, dashboard "Active restrictions" counts app rules.
- **Phase 17c-1** — Android rules pull: `GET device-config` + ETag, sealed cache, stale/expiry, child-visible rules list.
- **Phase 17c-2** — Android limit check: today's screen time (local usage events) vs the device-local weekday limit; ALLOW/WARN/LIMIT; "Today's screen time" on Device status; full-screen "limit reached" notice (dismissable, informs only, cannot lock the phone). Memory only, nothing sent.
- **Phase 18a** — app restrictions backend: RPC `parent_set_app_rule` (block / daily limit per package, ≤ 200 per device, child app protected), `app_rules` in `device-config` (versioned like 17a), Edge `device-app-events` (throttled `BLOCKED_APP_ATTEMPT`, package + time only). Track A informs only; it cannot hard-block.
- **Phase 19a-1** — schedules SQL: `parent_save_schedule` / `parent_delete_schedule` / `parent_set_device_timezone`, ≤ 20 windows per device, same-type overlap guard on every write path, per-device IANA time zone (NULL = device's own), versioned like 17a/18a, `device_get_config` gains `o_timezone` + `o_schedules`; `15_schedules.test.sql` (177 tests, not executed). Edge/contracts follow in 19a-2.
- **Phase 19a-2** — schedules Edge + contracts: `device-config` now returns `timezone` and `schedules`; contracts `scheduleSchema`, `timezoneSchema`, `SCHEDULES_MAX`, parent input schemas, outcome lists, week-range/overlap helpers; Edge mirror; drift tests vs the 19a-1 migration; +5 Deno tests; Android drift test expects the keys on the wire but not in the DTO until 19c.
- **Phase 18c** — Android app restrictions: cached `app_rules` (codec v2), on-device per-app check (ALLOW/WARN/LIMIT/BLOCKED) from Usage Access events, full-screen blocked/limit notice inside FamilySafe, Device status "App rules from your parent", `BLOCKED_APP_ATTEMPT` upload (package + time only, sealed outbox, de-duplicated). Track A detects and informs; it cannot close apps. No new permission. `versionName` 0.18.0. Kotlin not compiled/run in the sandbox.

**Database tests without Docker:** `npm i --no-save @electric-sql/pglite` once, then `npm run test:db:local` (or `-- 21 22` for single files) runs bootstrap, every migration, the seed and every pgTAP file on an in-process PostgreSQL with a small pgTAP-compatible shim. CI runs the real pgTAP (`scripts/db/verify.sh`).
