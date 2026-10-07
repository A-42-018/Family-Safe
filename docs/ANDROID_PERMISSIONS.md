# ANDROID_PERMISSIONS — Capability Feasibility Matrix

> Assessed at Phase 1 from platform knowledge; **every row must be re-verified against current Android docs and Google Play policy before its implementation phase** (Play policy changes often). Nothing here bypasses a restriction. Nothing is covert: every collection path is enrollment-consented, runtime-permission gated, and visible in the child app.

| Capability | API / Permission | Special requirement | Track A (Play consumer) | Track B (Device Owner / private) | Phase |
|---|---|---|---|---|---|
| Precise location | `ACCESS_FINE_LOCATION` (+COARSE), Fused Location Provider | Runtime; Android 12+ user may grant approximate only → report `precise=DENIED` | ✅ | ✅ | 21 |
| Background location / history | `ACCESS_BACKGROUND_LOCATION`; FGS type `location` if continuous | Play **permissions declaration + prominent disclosure**; request only if geofence/history enabled; separate 2nd prompt | ✅ with declaration | ✅ | 22 |
| Geofencing | `GeofencingClient` (Play Services), ≤100 fences/app | Needs background location for background ENTER/EXIT; re-register after reboot | ✅ | ✅ | 23 |
| Camera | `CAMERA`, CameraX | Foreground, user-initiated only; system privacy indicator always shown; FGS type `camera` cannot start from background (A14+) | ✅ QR enrollment, user-initiated emergency photo | ✅ | 10/27 |
| Microphone | `RECORD_AUDIO`, FGS type `microphone` | Only user-initiated (e.g., emergency call/voice message) with visible notification; while-in-use rules (A14+); no boot-launched mic FGS (A15) | ✅ user-initiated only | same | 28 |
| Contacts | `READ_CONTACTS` / **Contact Picker** (`ACTION_PICK`) | Prefer picker (no permission); sync only chosen emergency contacts | ✅ picker | ✅ | 25 |
| SMS read/receive/send | `READ_SMS`,`RECEIVE_SMS`,`SEND_SMS`,`WRITE_SMS` | Play **restricted**: only default SMS/Phone/Assistant handler or narrow listed exceptions; parental monitoring is not an eligible use | ❌ monitoring unavailable. Alternatives: emergency alert via backend/FCM (no SMS); optional `SmsManager` send only if declared; parent-side SMS-free alerts | Private/sideload: technically requestable (user grant + Android 13+ *restricted settings* for sideloaded apps) — still no accessibility/notification scraping | 26 |
| Call log | `READ_CALL_LOG`,`WRITE_CALL_LOG` | Play **restricted** (default Phone/Dialer handler only, narrow exceptions) | ❌ show "Feature unavailable under current Android/Play distribution requirements." Alternative: parent-managed allowed-contacts list, emergency-call button | Private build only, same platform rules | 26 |
| Phone state | `READ_PHONE_STATE` | Avoid; not needed | Use `ConnectivityManager` / `TelephonyManager` without permission where possible | — | 13 |
| Installed apps inventory | `PackageManager`; Android 11+ package visibility → `QUERY_ALL_PACKAGES` | Play **declaration**; parental-control is an eligible core use (verify); fallback: `<queries>` launcher-intent filter (lists launchable apps only, no declaration) | ✅ start with `<queries>` LAUNCHER intent; escalate to QUERY_ALL_PACKAGES only if justified | ✅ | 15 |
| App usage / screen time | `UsageStatsManager` (`PACKAGE_USAGE_STATS`) | Special app access granted by user in Settings; declared purpose | ✅ | ✅ | 16 |
| Screen-time limit & app blocking (enforcement) | Track A: foreground detection via `UsageEvents` (short-interval poll only while screen on) + full-screen block Activity / overlay (`SYSTEM_ALERT_WINDOW`) ; Track B: `DevicePolicyManager.setPackagesSuspended`, `setLockTaskPackages`, `setApplicationHidden` | **AccessibilityService is NOT used** (Play policy limits it to accessibility tools). Track A enforcement is best-effort & user-visible; child can uninstall (parent alerted via heartbeat loss) | ⚠ best-effort | ✅ strong | 17/18 |
| Bedtime / school mode | Same as above + `NotificationManager` DND access (`ACCESS_NOTIFICATION_POLICY`) optional | — | ⚠ best-effort | ✅ (`DevicePolicyManager` lock/kiosk) | 19 |
| Device / battery / network | `BatteryManager`, `ConnectivityManager` (`ACCESS_NETWORK_STATE`) | — | ✅ | ✅ | 12/13 |
| Push wake-up | FCM, `POST_NOTIFICATIONS` (A13+) | High-priority FCM data msgs for sync only | ✅ | ✅ | 20 |
| Emergency button | Foreground UI + location + backend alert | Location foreground at press-time (no bg needed); optional user-initiated call | ✅ | ✅ | 24 |
| Remote config / rules | Backend-authoritative, Room cache | — | ✅ | ✅ (+Managed Configurations) | 17 |
| Uninstall protection / kiosk | `DevicePolicyManager.setUninstallBlocked`, lock-task | Device Owner only; visible to user; **never** hidden/anti-removal malware behavior | ❌ | ✅ (parent-visible, removable via parent-approved unenroll) | 31+ |
| Boot / restart resilience | `BOOT_COMPLETED` → reschedule WorkManager & geofences | A15 limits FGS launch from boot: use WorkManager, not FGS | ✅ | ✅ | 12 |

## Foreground services (only where genuinely required)
1. `location` — only while continuous tracking is enabled by parent **and** child app shows persistent notification.
2. `microphone`/`camera` — only for explicit, user-initiated emergency actions; ends when action ends.
Everything else uses WorkManager + FCM.

## Permission Center (child app) — data per permission
`os_status` (live `checkSelfPermission`/AppOps), `why_needed` text, `last_verified_at`, `how_to_enable` (deep link to app settings), `feature_available` (Track/Play gating). Values sync to `device_permissions` — informational, not proof.

## Device Owner facts
- Provisioned only on unprovisioned/factory-reset devices (QR, NFC, zero-touch, or `adb dpm set-device-owner` for dev). Cannot be silently self-elevated from a Play install.
- Work-profile (Profile Owner) alternative exists for BYOD but is less suited to whole-device parental control.
- Removal path: parent unenroll → `clearDeviceOwnerApp` → child regains full control. No hidden persistence.

## Phase 9 manifest guard
Phase 9 requested only `INTERNET` and `ACCESS_NETWORK_STATE` (Phase 12b adds `RECEIVE_BOOT_COMPLETED`, Phase 16b adds `PACKAGE_USAGE_STATS`; see below). The current allow-list is exactly those four. WorkManager's library manifest also contributes `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC`; they are removed with `tools:node="remove"` until a phase needs them (boot reschedule: Phase 12) and re-added deliberately. Gradle task `verify<Variant>ManifestPermissions` (part of `check`) fails the build if the **merged** manifest requests anything else, except androidx.core's app-private `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. Adding a permission = change the app manifest, the allow-list in `app/build.gradle.kts`, and this document.

## Phase 10 — enrollment
No permission was added. Enrollment is typed/pasted only; scanning the pairing QR needs `CAMERA` (and the parent dashboard does not render a QR image yet), so it is deferred to when both exist — at that point `CAMERA` is added to the manifest, the allow-list in `app/build.gradle.kts`, the child-visible Permissions screen ("used to scan the pairing code", already worded) and this file. A `familysafe://enroll` deep link is also deferred: an exported, browsable activity would let any web page or app pre-fill a code, so it needs an explicit confirmation design first.

## Phase 12b — heartbeat
**One permission added: `RECEIVE_BOOT_COMPLETED`** (normal, install-time permission: no prompt, no data access). It is contributed by WorkManager's own manifest and was removed in Phase 9. Reason kept: WorkManager re-creates its periodic jobs after a reboot through a boot receiver; without the permission the heartbeat would stay silent after a restart until the child opens the app, and the parent would see the device as offline. It is now in the app manifest and in the merged-manifest allow-list in `app/build.gradle.kts`. `WAKE_LOCK`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC` stay removed (the beat is a short network call; no foreground service, no wake locks). Battery state comes from the sticky `ACTION_BATTERY_CHANGED` broadcast and the network type from `ConnectivityManager` (`ACCESS_NETWORK_STATE`, already declared): neither needs a new permission. **Unverified:** that the merged manifest and WorkManager 2.10.5 behave as described (no Gradle in the authoring sandbox) — check `verifyDebugManifestPermissions` and reboot an emulator once.

## Phase 13b — device information
**No permission added.** API level and patch date are public `Build` fields; storage size comes from `StatFs` on the data directory. Manifest stays `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` (a JVM test asserts the declared set). `versionName` 0.13.0.

## Phase 14b — permission state sync
**No permission added.** The app only *reads* the grant state (`checkSelfPermission`, `hasSystemFeature`) and never prompts. Manifest stays `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` (a JVM test asserts the declared set), so until a phase declares a permission its state reads `NOT_REQUESTED` (or `NOT_AVAILABLE` for SMS and call log, which Track A never declares, and for missing camera/microphone/location hardware). `versionName` 0.14.0. **Unverified:** behaviour on a real device after the child changes a permission in Settings (resume re-read) and `hasSystemFeature` results on emulators.

## Phase 15b — app inventory
**No permission added; one `<queries>` element added.** The reader calls `PackageManager.queryIntentActivities` for `ACTION_MAIN` + `CATEGORY_LAUNCHER`. Since Android 11 an app only sees other packages it declares in `<queries>`; the manifest declares exactly that one launcher intent (no `<package>`, no `<provider>`). This is **package visibility, not a permission**, so the merged-manifest allow-list (`INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`) is unchanged. The broad "all packages" permission is deliberately **not** used: Google Play restricts it to a short list of core use cases, and launchable apps are all a parent needs. Consequence: apps without a launcher entry (background services, some system components) are invisible to FamilySafe by design. Package changes are not watched with a broadcast (no receiver); the list is re-read on app start/resume (throttled to 15 minutes) and by the daily job. `Flags` overloads of `queryIntentActivities`/`getPackageInfo` are API 33+, so API 31-32 use the deprecated int overloads. `versionName` 0.15.0. **Unverified:** what a real launcher-intent query returns on Android 12-16 devices and emulators (manufacturer launchers may add or hide entries), and lint on the `@Suppress("DEPRECATION")` branches.

## Phase 16b — usage statistics (`PACKAGE_USAGE_STATS`)
**One permission added: `PACKAGE_USAGE_STATS`** (Usage Access, a *special app access*, not a runtime permission). Only the child can switch it on, in Android settings; the app never grants it, never shows a system prompt for it and reads nothing until it is on. The manifest element carries `tools:ignore="ProtectedPermissions"` (lint's generic warning for permissions only the settings screen can grant). It is in the merged-manifest allow-list in `app/build.gradle.kts`, described on the child-visible Permissions screen, and four JVM drift tests now expect the set `{INTERNET, ACCESS_NETWORK_STATE, RECEIVE_BOOT_COMPLETED, PACKAGE_USAGE_STATS}` (helper `RepoFiles.declaredPermissions` ignores `tools:node="remove"` entries).

- **Guide:** the Permissions screen has a Usage Access row (on / off / unknown) and a guide that explains why, lists the three steps and opens `Settings.ACTION_USAGE_ACCESS_SETTINGS` (`UsageAccessSettings`). If a device has no such page `open()` returns false and nothing happens (no crash, no message yet — a known gap). The state is read with `AppOpsManager.unsafeCheckOpNoThrow` (API 29+; minSdk 31), re-read on every app resume, and is never proof by itself: anything unexpected reads as "unknown", never "granted".
- **Collector:** `UsageStatsManager.queryEvents` for one local calendar day. Only five event types are kept (activity resumed/paused, screen interactive/non-interactive, keyguard hidden), and only package name and time; no class names, shortcuts, notification events or content. Not used: `queryUsageStats` aggregates, `QUERY_ALL_PACKAGES`, accessibility, notification access.
- **Day boundaries:** the contract `day` is the child's local date; a day's window ends at the start of the next local day (23/24/25 h around daylight-saving changes). Today's window ends "now". On the first upload of a new local day yesterday is sent once more so its last hours are not lost (the server keeps the larger value per column).
- **Turned off again:** with Usage Access off the worker reads nothing and sends nothing (`NoAccess`); data already on the server stays until the parent deletes it or retention removes it.
- **Not a Play shortcut:** Usage Access is a declared-purpose special access on Play; the store listing must describe screen-time monitoring for a parent-enrolled child device (verify the current policy text before release).
- `versionName` 0.16.0. **Unverified on a device:** `queryEvents` results on Android 12-16 (OEM differences in event delivery), the settings page on managed devices, lint on the new permission element.

## Phase 17c-2 — limit check
No new permission. Uses Usage Access (already listed) via `UsageStatsManager.queryEvents`, read-only. No overlay (`SYSTEM_ALERT_WINDOW`), no accessibility service, no device-admin: Track A can inform only. The check runs on resume and once a minute while the activity is STARTED; there is no foreground service or background loop. A source-level JVM guard (`LimitEnforcementGuardTest`) fails on lock/overlay APIs and on any new permission.

## Phase 18a — app restrictions (backend)
No new permission and no manifest change. 18c will detect the foreground app through the already declared Usage Access (`PACKAGE_USAGE_STATS`) — no accessibility service, no overlay permission. **Track A cannot hard-block apps**: the app can show a notice and report the attempt; it cannot stop the other app from running. Hard blocking requires Track B (Device Owner / managed device). 

## Phase 18c — app restrictions on the device (Track A detect + inform; Track B hard block)
**No new permission, no manifest change** (no component, no overlay, no accessibility service, no `QUERY_ALL_PACKAGES`). A JVM guard (`AppRuleEnforcementGuardTest`) fails on lock/overlay/hide/suspend APIs, on any added permission, `<service>` or `<receiver>`.

| | Track A (Play consumer, this app) | Track B (Device Owner / managed, not built) |
|---|---|---|
| Blocked app opened | Detected from `UsageStatsManager.queryEvents` (already-declared Usage Access). The child sees a full-screen notice **inside FamilySafe** the next time the app is open; the parent is told *which app and when* (`BLOCKED_APP_ATTEMPT`). The other app keeps running. | `DevicePolicyManager.setPackagesSuspended` / `setApplicationHidden` would stop the app. |
| App limit reached | Measured on the phone (minutes in the foreground today); notice inside FamilySafe. **Nothing is reported** for limits. | Suspend the app when the limit is reached. |

Detection runs only on the existing triggers: app resume, a rules change, and once a minute while the FamilySafe activity is STARTED. There is no foreground service and no background loop, so a blocked app opened while FamilySafe is closed is noticed at the next resume (events since the last check, never older than ~23 h, so the server would accept them). Opening an app **before** the device received the rule version is not an attempt (the first check after a new version only sets the starting point). Usage Access off or unreadable is an explicit state, never "allowed". `versionName` 0.18.0. **Unverified:** everything Kotlin (no Gradle/kotlinc in the sandbox), and `queryEvents` behaviour per OEM.
