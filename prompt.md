# Master Prompt (verbatim source of truth — do not edit without user approval)

## Role
Senior full-stack architect and Android engineer. Build a **production-grade parental-control and family-safety platform**: Parent Web Dashboard, Child Android App, Secure Backend/API, PostgreSQL, Push/command sync, Device management, Permission & sensitive-data management. A parent manages/monitors their child's *enrolled* Android device via a secure dashboard.

## 1. Required product areas (do NOT remove because they are sensitive)
Precise location; location history; geofencing; camera; microphone; contacts; SMS (where Android/Play permits); calls (where permitted); call history (where technically/policy permitted); installed app inventory; app usage stats; screen-time monitoring; screen-time limits; app blocking; app-specific limits; bedtime schedules; school mode; device status; battery; network; device info; remote configuration; emergency/safety features; parent notifications; device activity/events; audit logs.
For each: determine correct Android API, permission model, device-management mechanism, role/default-handler requirement, foreground-service requirement, Play Store requirement, or alternative. If not possible via a normal Play Store app, state the constraint and design the correct alternative architecture.

## 2. Transparency & safety — DO NOT implement
Secret camera; hidden mic recording; covert ambient audio; secret photo/video; keylogging; password extraction; private message interception via unauthorized mechanisms; credential theft; permission bypass; Android security bypass; root exploits; stealth malware behavior; anti-uninstall malware behavior; persistence via exploits; hiding processes; circumventing privacy indicators; circumventing Google Play restrictions.
Child device must be enrolled into the parent's family account. Child app may have minimal UI but must not disguise itself as another app or use stealth.

## 3. Stack
Web: Next.js, TypeScript, App Router, Tailwind, shadcn/ui, Supabase JS, Recharts, React Hook Form, Zod.
Backend: Supabase (Postgres, Auth, RLS, Edge Functions, Realtime), Firebase Cloud Messaging.
Android: Kotlin, Android Studio, Jetpack, Compose, Coroutines, WorkManager, Room, Android Keystore, FCM, UsageStatsManager, Location APIs, Geofencing APIs, device-management APIs. Target Android 12–16. No private/undocumented APIs.

## 4. Architecture
Parent Web → HTTPS → Supabase Auth/API → PostgreSQL + RLS → FCM/HTTPS → Child Android App → Android OS APIs.
Parent dashboard never talks directly to the device. FCM is signal/wakeup only; no sensitive data in FCM payloads; device fetches latest config from backend after signal.

## 5. Roles
Parent: create family, add children, enroll devices, view status, configure rules, view allowed monitoring data, screen-time limits, app restrictions, schedules, location (where enabled), geofences, alerts, audit history.
Child Device (Android app): registers/enrolls, maintains secure auth, reports status, syncs config, collects only enabled/authorized data, applies rules locally, sends events, receives commands, keeps local config offline.

## 6. Family model
Parent → many Children → many Devices each.

## 7. Database (PostgreSQL migrations)
profiles(id UUID PK, email UNIQUE, full_name, avatar_url, created_at, updated_at)
families(id, parent_id, name, created_at, updated_at)
children(id, family_id, name, date_of_birth DATE NULL, avatar_url NULL, created_at, updated_at)
devices(id, child_id, device_name, manufacturer, model, android_version, app_version, device_status, enrollment_status, battery_level INT, is_charging BOOL, network_type, last_seen_at, created_at, updated_at)
device_tokens(id, device_id, fcm_token, created_at, updated_at) — never expose FCM tokens to parent frontend.

## 8. device_rules
id, device_id, daily_screen_limit_minutes INT, bedtime_enabled, bedtime_start TIME, bedtime_end TIME, school_mode_enabled, location_enabled, location_history_enabled, geofence_enabled, updated_at

## 9. app_rules
id, device_id, package_name, app_name, blocked BOOL, daily_limit_minutes INT NULL, created_at, updated_at

## 10. app_usage_daily
id, device_id, package_name, usage_date DATE, foreground_minutes INT, launch_count INT, created_at

## 11. device_usage_daily
id, device_id, usage_date DATE, total_screen_minutes INT, unlock_count INT, created_at

## 12. location_points
id, device_id, latitude DP, longitude DP, accuracy_meters DP, altitude DP NULL, speed_mps DP NULL, recorded_at, created_at.
Collect only per enabled feature and actual Android authorization. Not indefinitely: configurable retention (7/30/90 days) with automatic deletion.

## 13. Geofencing
geofences(id, device_id, name, latitude, longitude, radius_meters INT, enabled, created_at, updated_at)
geofence_events(id, device_id, geofence_id, event_type ENTER|EXIT, occurred_at, created_at)

## 14. schedules
id, device_id, name, type BEDTIME|SCHOOL|CUSTOM, start_time TIME, end_time TIME, days INT[], enabled, created_at, updated_at

## 15. device_events
id, device_id, event_type, metadata JSONB, created_at.
Examples: DEVICE_ONLINE, DEVICE_OFFLINE, APP_INSTALLED, APP_UNINSTALLED, RULE_UPDATED, LOCATION_PERMISSION_CHANGED, CAMERA_PERMISSION_CHANGED, MICROPHONE_PERMISSION_CHANGED, BATTERY_LOW, GEOFENCE_ENTER, GEOFENCE_EXIT

## 16. device_commands
id, device_id, command_type, payload JSONB, status PENDING|DELIVERED|EXECUTED|FAILED|EXPIRED, expires_at, created_at, executed_at NULL. Replay protection and expiration required.

## 17. device_permissions
id, device_id, camera_status, microphone_status, contacts_status, sms_status, call_log_status, location_status, precise_location_status, background_location_status, last_verified_at, created_at, updated_at.
Values: GRANTED, DENIED, REVOKED, RESTRICTED, NOT_AVAILABLE, NOT_REQUESTED.
DB status is only a synchronized representation, NOT proof. Android app must query real OS state and sync.

## 18. Camera
android.permission.CAMERA. Legit: QR enrollment, parent-child enrollment workflow, user-initiated camera, emergency/safety where appropriate. Never secret activation; obey privacy indicators & runtime permissions.

## 19. Microphone
RECORD_AUDIO. Legit: voice communication, emergency communication, user-initiated audio. No hidden ambient/continuous/background surveillance. If via foreground service: correct FGS type, notification, lifecycle, permissions for target SDK.

## 20. Contacts
READ_CONTACTS / WRITE_CONTACTS; minimum necessary; prefer contact picker. Features: emergency/family/parent/safety contacts. Minimize backend sync; never upload whole contact DB unnecessarily.

## 21. SMS
READ_SMS, RECEIVE_SMS, SEND_SMS, WRITE_SMS — do not blindly implement. First determine if permitted under Android + Google Play (heavily restricted; default-handler requirement for many cases). If not permitted: do NOT bypass; do NOT derive SMS via other permissions; NO accessibility abuse; NO notification scraping as hidden replacement; NO interception via unsupported APIs; document limitation; implement compliant alternative if any. Private/internal distribution still follows Android platform security/privacy.

## 22. Call log
READ_CALL_LOG / WRITE_CALL_LOG. Determine eligibility first; no bypass; no alternative APIs to reconstruct history. If unavailable show: "Feature unavailable under current Android/Play distribution requirements." and provide compliant alternative.

## 23. Phone state
READ_PHONE_STATE only if minimum required.

## 24. Location
ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION; ACCESS_BACKGROUND_LOCATION only where genuinely required and permitted. Implement current location, history, refresh, geofencing, permission status, accuracy, last updated. Correct Android location APIs. Don't request background location for convenience.

## 25. Parent location dashboard
Current location, last update, accuracy, timestamp, map, history, geofences, entry/exit events. Provider-agnostic map; check pricing/licensing.

## 26. Android Permission Center screen
Per permission: current OS status, why required, last verification time, how to enable, whether feature is currently available. (Camera, Microphone, Contacts, SMS, Call History, Precise Location, Background Location.)

## 27. Enrollment
Parent creates child → Add Device → backend generates short-lived pairing code or QR with short-lived token. Child app: open → scan QR → confirm → authenticate device → register FCM → upload device info → sync config. Token: expires, single-use, cryptographically random, invalidated after enrollment, never a permanent password.

## 28. Device authentication
Never use parent's Supabase token as device credential. Dedicated device auth: device-specific credentials, short-lived access tokens, refresh-token rotation, Android Keystore, secure storage, revocation. Parent/device auth logically separated.

## 29. Heartbeat
Send device_id, app_version, android_version, battery_level, charging, network_type, last_sync, permission_state. Not excessive; WorkManager.

## 30. Offline mode
Cache latest valid screen-time rules, app restrictions, schedules, device config. On reconnect: sync changes, fetch latest config, ack commands. Prevent stale rules persisting indefinitely.

## 31. Rule engine (local Android)
States ALLOW/WARN/LIMIT/BLOCK. Example limit 60 min: 0–50 ALLOW, 50–60 WARN, 60+ BLOCK. Server authoritative; device enforces latest valid config.

## 32. Screen-time management
Daily total, per-app, daily limits, app blocking, bedtime, school mode, history, daily/weekly charts. Use supported APIs; identify special privileges before implementing.

## 33. Application management
Device reports package_name, application_name, version_name, version_code, install_time. Parent sees Allowed / Limited / Blocked. Sync + enforce via supported mechanisms.

## 34. Emergency
Child emergency button → parent gets alert with location, battery, network, timestamp. Any camera/mic use: supported APIs, explicit authorization, visible indicators. No secret recording.

## 35. Web pages
/dashboard, /children, /children/[id], /devices, /devices/[id], /devices/[id]/{overview,usage,applications,location,geofences,permissions,rules,schedules,activity}, /notifications, /audit-logs, /settings

## 36. Dashboard
Children, Devices Online/Offline, Today's Screen Time, Battery, Last Location, Active Restrictions, Alerts. Professional responsive UI.

## 37. Security model
Supabase Auth email/password, email verification, password reset, optional MFA. RLS: parent only their family/children/devices/data. Never expose service role key, private API secrets, FCM credentials to browser. API: Zod, authn, authz, rate limiting, input validation, audit logging.

## 38. Sensitive data security
Sensitive: location, contacts, SMS, calls, camera/mic-derived info, device identifiers. HTTPS only; encryption at rest; RLS; least privilege; short retention; secure deletion; audit + access logs; no needless third-party sharing; no ad use; no sensitive data in FCM; no sensitive data in client logs. Never in console.log, crash reports, analytics, FCM payloads, URLs, public storage.

## 39. audit_logs
id, parent_id, device_id NULL, action, metadata JSONB, ip_address INET NULL, created_at. Actions: LOGIN, DEVICE_ENROLLED, DEVICE_REMOVED, RULE_CHANGED, APP_BLOCKED, APP_UNBLOCKED, LOCATION_VIEWED, LOCATION_SETTINGS_CHANGED, PERMISSION_STATE_CHANGED, DEVICE_COMMAND_SENT. No sensitive content.

## 40. API structure
/auth; /children, /children/:id; /devices, /devices/:id, /:id/enroll, /:id/heartbeat, /:id/revoke; /:id/rules; /:id/apps, /:id/apps/:packageName; /:id/usage, /usage/today, /usage/history; /:id/location, /location/history; /:id/geofences; /:id/schedules; /:id/permissions; /:id/commands; /notifications; /audit-logs.
Separate Parent APIs / Device APIs / Admin-internal APIs. Device token must never reach parent-only endpoints.

## 41. Command system
Parent blocks YouTube → backend updates app_rules, creates device_command, sends FCM signal. Device: receive FCM → authenticate → fetch command → validate → execute → update local state → ack. Never trust FCM message as authorization.

## 42. Rate limiting
Login, enrollment, pairing, heartbeat, location uploads, commands, password reset, API. Server-side.

## 43. Android security
Keystore, encrypted local storage, Network Security Config, HTTPS, cert/transport best practice, secure BroadcastReceivers, exported-component restrictions, explicit intents, non-exported internals, input validation, token rotation. No secrets in plaintext SharedPreferences, source, BuildConfig, Git, logs.

## 44. Battery
No 1-second polling, continuous requests, unnecessary FGS. Use WorkManager, FCM, batching, adaptive location intervals, significant-change, supported background mechanisms. Justify any foreground service.

## 45. Privacy architecture
Configurable retention: location 7/30/90 d; usage 90 d; audit 180 d. Cleanup jobs. Parent can delete child's historical data. Device removal revokes credentials immediately.

## 46. Android / Play compatibility (critical)
Before any sensitive capability: check Android docs; Play policy; restricted permission?; default handler?; FGS?; background access?; policy declaration?; alternative API? No bypass. If not available in normal Play app explain: why restricted, what Android permits, what Play permits, alternative architecture, whether private/enterprise/device-owner changes available APIs. Don't delete the feature from architecture.

## 47. Device Owner / managed device
Investigate Android Enterprise / DevicePolicyManager: Device Owner, managed device, managed configurations, kiosk/lock-task, app restrictions. Separate normal consumer app from managed/device-owner deployment. Don't pretend a Play app has system privileges.

## 48. Child app UX
Device Status, Permissions, Enrollment, Sync Status, Safety, About. Minimal technical controls for child. No disguise, no stealth.

## 49. Parent notifications
Device offline, battery low, emergency, geofence enter/exit, permission revoked, screen-time limit reached, blocked app attempted, device enrollment, security event. Preferences supported.

## 50. Testing
Android 12–16; Wi-Fi; mobile data; offline; reboot; process kill; battery saver; Doze; permission revoke/restore; timezone/date change; network switching; poor connectivity; duplicate/expired commands; device removal; re-enrollment; factory reset; FCM failure; backend failure.

## 51. Security testing
IDOR, broken access control, RLS bypass, JWT manipulation, token replay, pairing brute force, API abuse, rate-limit bypass, SQLi, XSS, CSRF, command replay, unauthorized registration, cross-family access, sensitive-data leakage, log leakage.

## 52. Development approach
Small phases fit in one Claude session. Each phase: objective; files to create; files to modify; DB changes; API changes; Android changes; Web changes; testing; acceptance criteria. Split if too large.

## 53. Phase order
1 Repo+architecture; 2 Supabase config; 3 DB migrations; 4 RLS; 5 Parent auth; 6 Dashboard shell; 7 Family/child mgmt; 8 Enrollment backend; 9 Android foundation; 10 Android enrollment; 11 Device auth; 12 Heartbeat; 13 Device info; 14 Permission sync; 15 App inventory; 16 Usage stats; 17 Screen-time rules; 18 App restrictions; 19 Schedules; 20 FCM command sync; 21 Location; 22 Location history; 23 Geofencing; 24 Emergency; 25 Contacts; 26 SMS/call assessment + compliant impl; 27 Camera; 28 Microphone; 29 Notifications; 30 Audit logs; 31 Security hardening; 32 Privacy/retention; 33 Integration testing; 34 Production prep.

## 54. Workflow (every phase)
Inspect repo → identify architecture/files/completed work → don't overwrite working code → short plan → implement ONLY current phase → run tests → fix errors → summarize exactly what changed. Never jump ahead.

## 55. Code quality
TS strict; Kotlin null-safe; clean architecture where practical; repository pattern; DI where useful; Zod; typed API responses; error handling; loading/empty states; logging; unit + integration tests. No unnecessary abstractions.

## 56. Error handling
Network ops handle: loading, success, empty, offline, timeout, unauthorized, forbidden, server error, validation error. Android also: permission denied/revoked, network unavailable, FCM unavailable, background restriction, battery optimization, reboot.

## 57. Docs
README.md, ARCHITECTURE.md, SECURITY.md, PRIVACY.md, ANDROID_PERMISSIONS.md, API.md, DATABASE.md, DEVELOPMENT_PLAN.md — covering architecture, DB, API, auth, enrollment, permissions, security, privacy, deployment, testing, Android limits, Play limits.

## 58. Decision rule for sensitive capabilities
Never answer "don't implement it". Determine: Android support? → permission/API? → foreground service? → Device Owner/managed? → Play permits? → official alternative? → architecture. Implement the supported solution; if restricted, keep feature in architecture and mark supported deployment model.

## 59. First task
Inspect repo; new vs existing; propose folder structure, system architecture, DB ERD, API architecture, Android architecture; identify Android/Play restrictions per sensitive capability; create small phases; implement ONLY Phase 1. Do not implement Phase 2+ until explicitly asked.
End of every phase report: Implemented / Files changed / Database changes / API changes / Android changes / Tests / Known limitations / Next phase.

## User preferences (standing)
- No intros, conclusions, or ethical disclaimers unless strictly necessary; go straight to the answer.
- Code requests: code block only, no explanation unless asked.
- After finishing a task: update plan.md (current phase + next roadmap) and deliver ALL coding files as ONE zip, not separately.
- Keep this prompt in prompt.md; keep necessary plan info in plan.md, maintaining phase.
