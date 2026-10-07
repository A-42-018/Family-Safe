# PRIVACY

- Consent-based: device enrolled by explicit pairing; child app shows what is collected and which permissions are active.
- Collect only what parent enabled **and** OS permission is granted; feature flags mirrored in `device_rules`.
- Retention defaults: location 30d (choices 7/30/90), usage 90d, audit 180d; automatic purge job; parent can delete child history on demand; device removal revokes credentials immediately.
- Contacts: picker-based, only chosen emergency contacts synced. SMS/call content: not collected on Play distribution.
- No ads, no third-party sharing of sensitive data; FCM carries no personal data.
- Play requirements to prepare: privacy policy, Data safety form, prominent in-app disclosure, permission declarations (background location, QUERY_ALL_PACKAGES if used), Families-policy review as applicable.
- **Enrollment (Phase 8):** pairing is parent-initiated and visible on the child's device; the server stores only a hash of the pairing code, the device name and optional manufacturer/model/Android/app version. Enrollment audit rows record no IP address. Revoking a device stops all sync and deletes its push registration; existing history is kept until the retention phase (32) or until the parent deletes the child.


## Heartbeat (Phase 12)
Every ~15 minutes the child's app tells the server: app version, Android version, battery percentage, charging yes/no, and network type (Wi-Fi/cellular/…). No location, no app names, no identifiers beyond what enrollment already shared, no Wi-Fi names. The parent sees online/offline, battery and last-seen time. Only the latest values are stored (overwritten each beat); `DEVICE_ONLINE`/`DEVICE_OFFLINE`/`BATTERY_LOW` events carry no data.

**Child-visible disclosure (Phase 12b).** The Sync status screen states, in plain words, that about every 15 minutes the device sends battery level, charging state, network kind (Wi-Fi / mobile data / …) and the app and Android versions, "nothing else by this feature", plus the time of the last acknowledged check-in.


## Device information (Phase 13)
About once a day the app will send: Android API level, security patch date, and total/free internal storage (MB). It is used only to show the parent whether the phone is up to date and running out of space. It never includes serial number, IMEI, advertising id, network addresses, installed apps or files. The child-facing "Device status" screen will list exactly these values (Phase 13b). Data is deleted with the device (cascade).

**Child-visible disclosure (Phase 13b).** The Device status screen now lists exactly what was last shared (Android API level, security patch date, free/total internal storage) and when, or "Not sent yet", plus a sentence saying that no serial number, phone number, advertising ID, network address, app names or files are included. The list shows the values the server acknowledged, not a fresh reading.

**Parent-visible display (Phase 13c).** The overview card shows only the values above plus "Updated N ago", and states what is never shared (serial number, phone identifiers, apps, files). Patch-age hints are informational and make no security claim.

## Phase 14a — permission state
Only the grant state of the 8 catalog permissions is sent (never the data behind them). Parents see state changes in the activity/audit trail.

## Phase 14b — permission state, child-visible
The Permissions screen now shows, per item, the real Android state in plain words (Allowed / Not allowed / Turned off / Restricted / Not available / Not requested) with one explanatory sentence, whether the item is shared with the parent ("only whether this is on or off") or stays on this device, and when the states were last shared ("Not shared yet" / a date). The Sync status screen says that about every 6 hours and when the app is opened FamilySafe tells the parent whether each permission is on or off. Eight items are shared (camera, microphone, contacts, text messages, call history, location, exact location, location in the background); screen-time access, installed apps and notifications stay on the device. Nothing the permissions would give access to is shared.

## Phase 14c — permission state, parent-visible
The permissions page shows only the on/off state of the 8 catalog permissions and "Updated N ago". It states that the values are the device's report (not proof) and that contacts, messages and calls are never shared. A turned-off permission gets a low-key badge and one factual sentence; no alert, notification or audit entry is created by the page (notifications = Phase 29).

## Phase 15a-2 — app inventory, what the server accepts
The endpoint accepts only package name, display label, version name and a system/user flag for launchable apps. It rejects anything else (icons, install time, usage, permissions, signing data) and refuses lists over 500 apps instead of truncating them. Nothing is shown to the child or the parent yet: the child-visible list is 15b and the parent view is 15c.

## Phase 15b — app list, child-visible
The Device status screen now has **"Apps shared with your parent"**: the exact list the server last acknowledged (app name, plus version and a "system app" note), when it was sent, and how many apps were left out (over the 500 limit or with a package name the contract cannot carry). It is collapsed by default. The list holds only apps that have a launcher entry (what the child sees on the home screen): name, technical package name, version name and a system/user flag. Never read or sent: icons, install or update times, usage, signing data, app data, or apps without a launcher entry. The list is sent about once a day and once more after the list changed (checked when the app is opened, at most every 15 minutes). It is cleared on re-pairing and when the device is disconnected.

## Phase 15c — app list, parent-visible
The applications page shows, for each launchable app the device reported: name, technical package name, version name and a "System" label, plus "Updated N ago". It states that the list is the device's report, can be out of date and only covers apps with a launcher entry, and that icons, install times, usage and app data are never shared. The page is read-only: it cannot block, limit or change anything on the device (restrictions = Phase 18). Searching only filters the list already loaded for the parent; the search text is not stored or logged.

## Phase 16a — usage statistics, what the server stores
Per device and calendar day: total screen-on minutes, number of unlocks, and per app the package name, foreground minutes and launch count. Not stored: session timestamps, in-app content, notifications, per-hour breakdowns. A parent can read and delete this history; the child sees exactly these fields on the device (Phase 16b). Kept 90 days (cleanup job in Phase 32). Collecting them needs the Usage Access special permission, which only the child can grant in system settings (Phase 16b); nothing is uploaded before that.

## Phase 16b — usage statistics, child-visible
Usage Access is **off by default and only the child can turn it on** (Android settings → Usage access → FamilySafe). The Permissions screen explains why, lists the three steps and shows whether it is on; turning it off stops all reading immediately. The Device status screen has **"Screen time shared with your parent"**: the exact numbers the server last acknowledged (day, screen-on time, unlocks, most used apps with minutes and launches, how many apps were left out because a report holds at most 200 apps and one day) and when they were sent, or "Not sent yet". Only the app's technical package name is sent; no names of websites, messages, photos, typed text or anything inside apps. About every 6 hours and when the app is opened (at most every 30 minutes).

## Phase 16c-1 — screen time, parent-visible
Parents now see, per device: screen-on time and unlock count for the last 7 days, and time and launches per app for one selected day (top 10). The page says these are the device's report, that they can be too low or out of date, and that no message or browsing content is shared. Nothing is shown before the first report, and a day without a report is shown as "no data", never as 0 minutes. Parents can already delete usage history (RLS `DELETE`); retention (90 days) stays with Phase 32.

## Phase 16c-2 — dashboard total
The dashboard shows one number: today's screen-on time added up over the enrolled devices that have reported. It uses only the per-day totals parents can already see on each device's usage page (no app names, no per-app minutes). It says how many devices are included, that each device uses its own date, and that numbers may be out of date; a device without a report is left out rather than counted as zero.

## Phase 17b — screen-time rules, parent-visible
The rules page shows and changes only the limits the parent chose (default daily limit, per-weekday overrides). It collects nothing new from the child. Saving writes limit values to `device_rules` and, in the database, an audit row naming only the changed **fields**, never the values; the web layer logs no limits, ids or names (operation name and error code only). The child's app pulls these settings on its own schedule and shows them in plain words in a later phase (17c). A setting is not proof that the phone follows it, and the copy says so.

## Phase 17c-2 — daily limit check (child-visible)
The app compares today's screen time with the limit your parent set. The comparison runs on the phone, only while the app is open, from the same Android usage numbers already listed above. The result is kept in memory only: it is not saved, not uploaded and not reported to your parent. A reached limit shows a notice; the app cannot lock the phone or close other apps.

## Phase 18a — app restrictions, what the server stores
Per app: package name, the parent's `blocked` flag and optional daily limit (parent-written), plus the app's display name the parent already sees from the app inventory. The device receives **only** package name, `blocked` and limit — never a label. A blocked-app attempt event stores **only** the package name and the time the child tried to open the app (no screen content, no duration, no location), only for packages the parent has blocked, throttled to one per package per 5 minutes and 200 per day. Events are device events: the parent can delete them (existing DELETE grant) and Phase 32 retention applies. Nothing is shown to the child about *other* children's rules; the child-visible list of rules and the blocked notice arrive with Android 18c.

## Phase 18b — app restrictions, parent-visible
The parent sees, per reported app, whether it is blocked or limited and can change that. Only package name, the blocked flag and the minutes are written; no label, no usage and no child data is sent by this page. The setting is stored for the device and delivered on its next sync; no app version applies it yet, and Android does not let the FamilySafe app close other apps or lock the phone.

## Phase 18c — app restrictions, what leaves the child's phone
The check of app rules runs on the phone from the rules and Usage Access numbers already described above. **Only one thing is sent:** when an app your parent **blocked** is opened, the package name and the time (UTC, whole seconds) go to the service (`BLOCKED_APP_ATTEMPT`). No label, no usage minutes, no other app and no device identifier. Reaching an app **limit** is shown on the phone only and is not sent. The same app is counted at most once per five minutes; unsent attempts wait in a small sealed outbox (≤ 40) and are dropped after about a day. The child is told all of this on Device status ("App rules from your parent") and on the blocked-app notice. Retention of the stored events follows the Phase 32 cleanup.

## Phase 19a-1 — schedules, what the server stores
Per window: the parent's name for it, its type, weekdays, start/end time and an on/off flag; per device optionally an IANA time-zone name. A child's daily routine is personal, so windows are written only by the owning parent and delivered only to the enrolled device that owns them. Nothing about schedules is reported back by the device in this phase, and audit rows record only that "schedules" changed.
