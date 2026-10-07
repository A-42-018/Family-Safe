# DATABASE

Schema per `prompt.md` §7–17, 39 + `pairing_tokens`, `device_credentials`. Later phases add: `installed_apps`, `notifications`, `notification_preferences`, `retention_settings`, `rate_limits`, `emergency_alerts`, `emergency_contacts`.

## Migrations (`supabase/migrations`, applied in order)
| File | Contents |
|---|---|
| `…000100_helpers` | `set_updated_at()` (uses `clock_timestamp()`), `is_valid_day_set(int[])` |
| `…000200_identity` | `profiles`, `families`, `children`; `auth.users` triggers (create profile, sync email change) |
| `…000300_devices` | `devices`, `device_tokens`, `device_credentials`, `pairing_tokens`, `device_rules`, `device_permissions`; `on_device_created` trigger |
| `…000400_rules_usage_schedules` | `app_rules`, `app_usage_daily`, `device_usage_daily`, `schedules` |
| `…000500_location` | `location_points`, `geofences` (max 100/device), `geofence_events` |
| `…000600_events_commands_audit` | `device_events`, `device_commands` (state machine), `audit_logs` (append-only) |
| `…000700_lockdown` | revoke all from `anon`/`authenticated` (tables, sequences, functions, default privileges); asserts RLS on every public table |
| `…000800_rls_policies` | `owns_family/owns_child/owns_device`, policies + column-level grants for `authenticated`, guard asserting policy coverage |
| `…000900_enrollment` | `enrollment_create_token`, `enrollment_redeem`, `enrollment_revoke_device` (SECURITY DEFINER, `service_role` only) |
| `…001000_device_auth` | `device_refresh`, `device_authorize` (SECURITY DEFINER, `service_role` only) |

## Conventions
- `uuid` PKs (`gen_random_uuid()`), `timestamptz`, `updated_at` trigger on mutable tables.
- Enums are `CHECK` constraints. Open-ended names (`event_type`, `command_type`, `audit_logs.action`) use format check `^[A-Z][A-Z0-9_]{1,63}$` so later phases add values without migrations.
- Cascade: `profiles → families → children → devices → all device data`. `audit_logs.device_id` is `ON DELETE SET NULL` (DEVICE_REMOVED stays auditable); `audit_logs.parent_id` cascades with the account.
- JSONB (`metadata`, `payload`) must be an object ≤ 8 KB. Never put coordinates, contacts, message text in `audit_logs`/`device_events` metadata.
- RLS enabled on **every** table at creation. `anon` has no grants and no policies. `authenticated` (parents) get only the policies/grants in the Phase 4 matrix below. `service_role` (Edge Functions) bypasses RLS. Lockdown fails if a table lacks RLS; the Phase 4 migration fails if a table lacks a policy (except the 3 secret tables).

## Enum values
- `devices.device_status`: ONLINE | OFFLINE | UNKNOWN · `enrollment_status`: PENDING | ENROLLED | REVOKED · `network_type`: WIFI | CELLULAR | ETHERNET | VPN | NONE | UNKNOWN
- `device_permissions.*_status`: GRANTED | DENIED | REVOKED | RESTRICTED | NOT_AVAILABLE | NOT_REQUESTED (default NOT_REQUESTED; a synchronized representation, not proof)
- `schedules.type`: BEDTIME | SCHOOL | CUSTOM · `days`: ISO weekdays 1=Mon..7=Sun, unique, non-empty · `end_time < start_time` = overnight
- `geofence_events.event_type`: ENTER | EXIT · `device_commands.status`: PENDING | DELIVERED | EXECUTED | FAILED | EXPIRED

## Integrity rules enforced in the DB
- New device → auto `device_rules` (everything OFF) + `device_permissions` (all NOT_REQUESTED).
- `device_rules`: bedtime needs start≠end; `location_history_enabled` and `geofence_enabled` require `location_enabled`; screen limit 0–1440.
- `geofence_events` FK is `(geofence_id, device_id)` → a geofence event can only reference a geofence of the same device. Radius 50–50 000 m; ≤100 geofences per device (Android limit).
- `location_points`: lat/lon range, `unique(device_id, recorded_at)` (idempotent batches).
- `app_rules`/`app_usage_daily`: `package_name` must match Android package format; unique per device (+ date).
- `device_commands` replay/expiry protection: identity fields immutable; forward-only transitions (PENDING→DELIVERED|FAILED|EXPIRED, DELIVERED→EXECUTED|FAILED|EXPIRED); terminal states final; EXECUTED refused after `expires_at`.
- `device_credentials`: SHA-256 hash only; at most one live (un-rotated, un-revoked) refresh token per device; `token_family_id` for reuse detection; row `id` = JWT `cid`.
- `pairing_tokens`: SHA-256 hash only; TTL ≤ 1 h; `consumed_at` single-use marker; `failed_attempts` for brute-force lockout (logic in Phase 8).
- `audit_logs`: UPDATE blocked (only the FK `SET NULL` on device deletion passes).
- Public functions executable by `authenticated`: `is_valid_day_set` (Postgres checks EXECUTE at runtime for CHECK functions) and `owns_family/owns_child/owns_device` (only answer "does auth.uid() own X"). Nothing is executable by `anon`/`PUBLIC`.

## Family model rules (Phase 7, app-level)
- **One family per parent** is enforced by the web layer, not the DB: `lib/family/service.ts` always uses the oldest owned family (`order by created_at, id limit 1`) and `createFamily` is idempotent. `families.parent_id` has no unique index, so a concurrent double-submit could create a second family; it stays invisible to the UI's write paths but its children would still be listed under RLS. If strict uniqueness is wanted, add `unique (parent_id)` in a migration + pgTAP test (deliberately deferred: no schema change in Phase 7).
- No family is auto-created at sign-up; first-run shows "Create your family" on `/children`.
- Deleting a child or family relies on the existing `on delete cascade` FKs (devices and all reported data go with it).

## RLS & grants (Phase 4)
Owner check: `families.parent_id = auth.uid()` → `owns_family(family_id)` → `owns_child(child_id)` → `owns_device(device_id)`. All policies are `to authenticated`.

| Table | Parent (`authenticated`) can | Notes |
|---|---|---|
| profiles | SELECT own; UPDATE `full_name`, `avatar_url` | email synced from auth; no insert/delete |
| families | SELECT/DELETE own; INSERT `parent_id`(=self), `name`; UPDATE `name` | `parent_id` immutable |
| children | SELECT/DELETE own family's; INSERT/UPDATE `name, date_of_birth, avatar_url` (+`family_id` on insert) | can't move between families |
| devices | SELECT; UPDATE `device_name` | create/revoke/remove = Edge Functions |
| device_rules | SELECT; UPDATE config columns | row auto-created; no insert/delete |
| device_permissions | SELECT | device-reported |
| app_rules, schedules, geofences | full CRUD | `device_id` insert-only |
| app_usage_daily, device_usage_daily, location_points, geofence_events, device_events | SELECT, DELETE | device-written only |
| device_commands | SELECT; INSERT `device_id, command_type, payload, expires_at` | policy: PENDING, expiry ≤ 24 h; no update/delete |
| audit_logs | SELECT own | insert via service_role only |
| device_tokens, device_credentials, pairing_tokens | **nothing** | service_role only |

Known gaps carried forward: location reads are not audited when done directly via PostgREST (route through an audited function in Phase 21/22); `owns_device()` is per-row (fine at current scale, see plan.md perf note).

## Enrollment functions (Phase 8)
All `SECURITY DEFINER`, `search_path=''`, `REVOKE`d from `public/anon/authenticated`, `GRANT EXECUTE` to `service_role`. They receive only hashes and a verified parent id from the Edge Functions.
| Function | Behaviour |
|---|---|
| `enrollment_create_token(parent, child, token_hash, ttl_s 60–3600)` → `timestamptz` or `NULL` | child must be in the parent's family (else `NULL`); advisory lock per child; deletes the child's unconsumed tokens (one live token); inserts the new one |
| `enrollment_redeem(token_hash, device_name, manufacturer, model, android_version, app_version, refresh_hash, refresh_ttl_s)` → 0 or 1 row `(o_device_id, o_credential_id, o_child_id)` | one transaction: consume token (`consumed_at is null and expires_at > now()`) → `devices` (`ENROLLED`; rules/permissions by trigger) → `device_credentials` → `audit_logs DEVICE_ENROLLED` (no IP); zero rows for unknown/expired/used; any error rolls consumption back |
| `enrollment_revoke_device(parent, device, ip)` → `'revoked' \| 'already_revoked' \| NULL` | ownership-checked; device `REVOKED`/`OFFLINE`, credentials `revoked_at`, `device_tokens` row deleted, audit `DEVICE_REMOVED` (parent IP); idempotent |

`pairing_tokens.failed_attempts` is unused: with an unguessable code a wrong guess matches no row, so attempts cannot be attributed to a token; guessing is limited per IP at the Edge instead.

## Retention (Phase 32)
`pg_cron` → `internal-jobs`: location 7/30/90 d per child setting, usage 90 d, audit 180 d. Purge-supporting indexes already exist (`location_points.recorded_at`, `*_usage_daily.usage_date`, `audit_logs.created_at`).

## Testing
`scripts/db/verify.sh` (plain PostgreSQL + pgTAP, bootstrap stubs Supabase roles/`auth`) or `supabase db reset && supabase test db`. Tests: `supabase/tests/database/01_schema … 06_enrollment` (245 tests; `05_rls` = two-family isolation suite, `06_enrollment` = ownership, single use, expiry, rollback, revoke, privileges). Seed (`supabase/seed.sql`, local only): parent `parent@example.test` / `Dev-Only-Passw0rd!`, one family/child/enrolled device, rules, usage.

### Device authentication functions (Phase 11)
| Function | Behaviour |
|---|---|
| `device_refresh(token_hash, new_hash, ttl_s 3600–31536000)` → one row `(o_outcome, o_device_id, o_credential_id)` | `rotated` (old row `rotated_at`+`replaced_by`, new live row in the same `token_family_id`) · `reused` (token was already rotated → family `revoked_at`, device `REVOKED`/`OFFLINE`, `device_tokens` deleted, audit `DEVICE_REMOVED` `{"reason":"credential_reuse"}` for the owning parent) · `invalid` (unknown, revoked, expired, device not `ENROLLED`; no side effects). Locks `devices` then `device_credentials`; the old row is marked rotated before the new one is inserted (one-live-per-device index). |
| `device_authorize(device_id, credential_id)` → `boolean` | true iff the credential belongs to that device, `revoked_at is null`, `expires_at > now()`, and the device is `ENROLLED`. NULL/unknown → false. |

### Heartbeat functions (Phase 12a)
| Function | Behaviour |
|---|---|
| `device_heartbeat(device_id, app_version, android_version, battery_level, is_charging, network_type)` → `(o_outcome)` | `recorded` (row locked; versions/battery/charging/network overwritten, `last_seen_at = now()`, `device_status = ONLINE`; `DEVICE_ONLINE` on transition into ONLINE; `BATTERY_LOW` on a new low state) · `inactive` (unknown or non-ENROLLED device, nothing written). Invalid values raise `22023`. `service_role` only. |
| `device_mark_stale_offline(stale_seconds 300–86400, default 2700)` → `int` | ENROLLED + ONLINE + `last_seen_at` older than the threshold → OFFLINE, one `DEVICE_OFFLINE` event each; returns the count. Idempotent. `service_role` only; not scheduled yet. |
Tests: `08_heartbeat.test.sql` (44).

### Device information (Phase 13a)
Migration `20260929001200_device_info.sql` adds to `devices`: `sdk_level int (1–99)`, `security_patch date (≥ 2010-01-01)`, `storage_total_mb int (1–16777216)`, `storage_free_mb int (0–16777216)`, `info_updated_at timestamptz`; constraints `devices_storage_pair_chk` (both storage values or neither) and `devices_storage_free_le_total_chk`. All NULL until the device reports.

| Function | Behaviour |
|---|---|
| `device_update_info(device_id, sdk_level, security_patch, storage_total_mb, storage_free_mb)` → `(o_outcome)` | `recorded` (row locked; the four columns overwritten, NULLs included; `info_updated_at = now()`; `device_status`/`last_seen_at` untouched; no events) · `inactive` (unknown or non-ENROLLED device, nothing written). Invalid values (sdk out of range, patch before 2010 or more than a day ahead, unpaired/negative/oversized storage, free > total) raise `22023`. `service_role` only, `SECURITY DEFINER`, empty `search_path`. |

Tests: `09_device_info.test.sql` (56: columns, privileges, CHECKs, validation, first/overwrite/NULL uploads, liveness columns untouched, inactive devices, family B untouched, parent read-only via RLS, anon denied). Total 402 pgTAP.

### Phase 14a — `device_update_permissions(uuid, jsonb)`
Migration `20260930001300_permission_sync.sql`. Returns `(o_outcome recorded|inactive, o_changed int)`. Invalid input raises `22023`. Stored state is a synchronized representation, not proof. Parents remain read-only on `device_permissions`.

### Phase 15a-1 — `device_apps` + `device_sync_apps(uuid, jsonb)`
Migration `20260930001400_device_apps.sql`. Table `device_apps` (`device_id`, `package_name`, `label`, `version_name` NULL, `is_system`, `first_seen_at`, `updated_at`; UNIQUE `(device_id, package_name)`; cascade on device delete) and `devices.apps_synced_at`. RLS: one `SELECT` policy (`owns_device`), parents have no write grant. Stored: package, label, version name, system flag only (no icons, install time, usage). `device_sync_apps` is a full replace: array ≤ 500 entries, each exactly `{package_name, label, version_name|null, is_system}`, no duplicates, invalid input raises `22023`; returns `(o_outcome recorded|inactive, o_added, o_updated, o_removed)`; unchanged rows are not rewritten. `APP_INSTALLED` / `APP_UNINSTALLED` device events only after the first report (baseline), one per package up to 20, else one `{count}` event per direction. No audit row; never touches `device_status` / `last_seen_at`. `service_role` only.


### Phase 16a — `device_upload_usage(uuid, date, jsonb)` + `devices.usage_synced_at`
Migration `20260930001500_device_usage.sql`. No new table: the function upserts `device_usage_daily (device_id, usage_date)` and `app_usage_daily (device_id, package_name, usage_date)` with `GREATEST` per column (never lowers, never deletes), then sets `devices.usage_synced_at = now()`. Parents keep `SELECT` + `DELETE` only on both tables (privacy: delete the child's history) and cannot write `usage_synced_at`; the function is `service_role` only. Returns `(o_outcome recorded|inactive, o_apps)`. Raced on real PostgreSQL: 24 parallel reports for one day → 24 × `recorded`, no errors, one row per table with the maximum values.


### Phase 17a — screen-time rules: `device_rules.daily_limit_overrides`, `config_version`, `parent_set_screen_time_rules`, `device_get_config`
Migration `20260930001600_screen_time_rules.sql`. New columns on `device_rules`: `daily_limit_overrides jsonb` (`{}`; CHECK `is_valid_day_limits`: object, keys `1`–`7`, integer values 0–1440) and `config_version int` (starts 1, CHECK ≥ 1). **Neither is granted to `authenticated`** (only SELECT); the existing column grants (daily limit, bedtime, school mode, location toggles) are unchanged, so the parent can still PATCH them directly and overrides only change through the RPC. BEFORE UPDATE trigger `device_rules_config_version` sets `config_version = old + 1` iff one of daily limit / overrides / bedtime enabled+start+end / school mode really changed, else keeps `old` (a caller-supplied value is overwritten); location toggles are not part of the config yet (Phase 21 extends the trigger and `device_get_config`). AFTER UPDATE trigger `device_rules_config_changed` (SECURITY DEFINER, only when the version moved): queue `SYNC_CONFIG` (`{}`, now()+24 h) for ENROLLED devices unless a PENDING one exists (DELIVERED does not dedupe), and write `RULE_CHANGED` (`metadata.fields` = changed column names, no values, `ip_address` NULL) when `auth.uid()` owns the device — service-role/seed changes write no audit row. `parent_set_screen_time_rules` (SECURITY DEFINER, `authenticated`): validates, ownership via `owns_device`, locks devices → device_rules, skips the write when nothing changed. `device_get_config` (SECURITY DEFINER, `service_role` only, read-only): config of an ENROLLED device, bedtime times hidden while disabled, otherwise an `inactive` default row. Existing pgTAP `05_rls` is unaffected (its direct rule updates now also create one command + one audit row for family A, which no later assertion counts). Per-device/child time zone is Phase 19.

### Phase 18a — app restrictions: `device_rules.app_rules_revision`, `app_rules_not_self`, `parent_set_app_rule`, `device_get_config.o_app_rules`, `device_record_app_attempts`
- **Columns/constraints:** `device_rules.app_rules_revision int not null default 0` (SELECT only for parents, bumped by triggers); `app_rules_not_self` CHECK (`package_name <> 'app.familysafe.child'`).
- **Triggers:** BEFORE INSERT cap (≤ 200 rules per device, `22023`); `app_rules_touch_revision` (AFTER INSERT of a restricting row, UPDATE of `blocked`/`daily_limit_minutes`, DELETE of a restricting row; SECURITY DEFINER) bumps `app_rules_revision` — a rename (`app_name`) or a no-effect row never does; `device_rules_bump_config_version` / `device_rules_config_changed` (17a) now include the revision.
- **`parent_set_app_rule(uuid, text, boolean, int)`** → `(o_outcome, o_config_version)`: `authenticated` only, SECURITY DEFINER, empty `search_path`. Outcomes `updated | cleared | unchanged | not_found | inactive | unknown_app`.
- **`device_get_config(uuid)`** returns a 9th column `o_app_rules jsonb` (array ordered by package name, ≤ 200, rows that restrict nothing absent, no `app_name`); `service_role` only.
- **`device_record_app_attempts(uuid, jsonb)`** → `(o_outcome recorded|inactive, o_recorded, o_ignored)`: `service_role` only. Validates every event before writing (3 keys, type, package pattern, UTC time pattern, window −24 h … +5 min → `22023`), locks `devices`, then ignores events for packages not blocked right now, within 300 s of an already stored attempt for the same package, or beyond 200 per device per 24 h. Stored in `device_events` (`event_type = 'BLOCKED_APP_ATTEMPT'`, metadata `{package_name, occurred_at}`); no audit row, no liveness change.
- **Tests:** `14_app_rules.test.sql` (133 tests), `o_app_rules` check in `13_screen_time_rules.test.sql`; `01_schema` routine allow-list now includes `parent_set_app_rule`.

### Phase 19a-1 — schedules: `device_rules.timezone`, `device_rules.schedules_revision`, `schedules` guards, `parent_save_schedule`, `parent_delete_schedule`, `parent_set_device_timezone`, `device_get_config.o_timezone/o_schedules`
Migration `20260930001800_schedules.sql` (SQL layer only; Edge + contracts = 19a-2).
- **Window model:** `schedules` (Phase 3) = `name`, `type` BEDTIME | SCHOOL | CUSTOM (school mode = SCHOOL windows, no separate flag), `days` (ISO 1–7), `start_time`/`end_time` at **minute resolution** (new CHECK), `enabled`. `end < start` = overnight and belongs to the day it **starts** on (Mon 22:00 → 06:00 covers Monday night into Tuesday); `start = end` is invalid. Disabled windows are stored, never delivered.
- **Guards on every write path** (BEFORE INSERT/UPDATE trigger `schedules_guard`, SECURITY DEFINER, serialised on the device row): ≤ **20** windows per device (`22023`); two **enabled** windows of the same type must not overlap on the weekly timeline (`23P01`; half-open, so 08:00–15:00 and 15:00–18:00 do not overlap; overnight windows wrap Sunday → Monday; different types may overlap). Rows that are invalid for another reason are left to their CHECK (`23514`). For a direct parent write the guard only looks when the parent **owns** the device, so a foreign device answers `42501` from RLS and nothing about it leaks through an error code.
- **Time zone:** `device_rules.timezone text NULL` — IANA name (`Region/City`, up to three parts, or `UTC`; no abbreviations, no `posix/`/`right/`/`SystemV/`), **NULL = use the device's own zone** (what the 17c limits do). CHECK = format only; existence in `pg_timezone_names` is checked by `parent_set_device_timezone` (`is_valid_iana_timezone`). Not granted to `authenticated`.
- **Versioning:** `device_rules.schedules_revision int` (SELECT only) is bumped by AFTER triggers when the device would see a difference (insert of an enabled window; update of name/type/times/days/enabled while enabled before or after; delete of an enabled window). `timezone` and `schedules_revision` are part of the 17a version tuple, so `config_version` / ETag / one `SYNC_CONFIG` / one `RULE_CHANGED` audit row (`fields`: `schedules`, `timezone`; never names or times) follow exactly as for 17a/18a. Legacy `bedtime_*` / `school_mode_enabled` stay in the payload and the tuple until 19c replaces them.
- **RPCs** (`authenticated` only, SECURITY DEFINER, empty `search_path`, ownership in SQL, foreign ≙ missing): `parent_save_schedule(device, schedule|null, name, type, days[], 'HH:MM', 'HH:MM', enabled)` → `(o_outcome, o_schedule_id, o_config_version)` with `created | updated | unchanged | overlap | limit_reached | not_found | inactive`; `parent_delete_schedule(device, schedule)` → `deleted | not_found | inactive`; `parent_set_device_timezone(device, tz|null)` → `updated | unchanged | not_found | inactive`. Invalid input `22023`, no session `42501`. Names are trimmed (1–100, no control characters); days are stored sorted.
- **`device_get_config(uuid)`** gains `o_timezone text` and `o_schedules jsonb` (enabled windows only, ordered by type, start, id, ≤ 20: `{id, name, type, days[asc], start_time "HH:MM", end_time "HH:MM"}`); `service_role` only.
- **Helpers** (not callable by parents): `schedule_week_ranges`, `schedule_conflicts`, `is_valid_iana_timezone`; `is_timezone_name_format` is a CHECK helper (executable by `authenticated`/`service_role`).
- **Tests:** `15_schedules.test.sql` (177 tests, **not executed here**); `05_rls` fixture schedules are now `enabled = false` (an enabled one queues a `SYNC_CONFIG` and broke the command counts); `01_schema` routine allow-list extended.
