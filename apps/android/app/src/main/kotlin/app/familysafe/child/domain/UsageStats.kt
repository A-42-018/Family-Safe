package app.familysafe.child.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Limits of `deviceUsageRequestSchema` (packages/contracts/src/device-usage.ts). A JVM test checks every one. */
object UsageLimits {
    const val MAX_APPS = 200
    const val MAX_MINUTES = 1440
    const val MAX_COUNT = 10000
    const val PACKAGE_MAX = 255

    /** Period of the WorkManager job; equals `DEVICE_USAGE_INTERVAL_SECONDS` (a JVM test checks it). */
    const val INTERVAL_HOURS = 6L

    /** On app resume an upload is only queued when the last acknowledged one is at least this old. */
    const val RESUME_MIN_AGE_MINUTES = 30L
}

/** Whether the child has switched on Usage Access for this app in Android settings. Never granted by the app. */
enum class UsageAccess { UNKNOWN, GRANTED, NOT_GRANTED }

/** What the OS says about Usage Access. Reading it shows no prompt and needs no permission. */
fun interface UsageAccessProbe {
    fun state(): UsageAccess
}

/** The kinds of OS usage events this app looks at; the Android source maps `UsageEvents.Event` types to these. */
enum class UsageEventKind { FOREGROUND, BACKGROUND, SCREEN_ON, SCREEN_OFF, UNLOCK }

/** One OS usage event. [packageName] is only meaningful for [UsageEventKind.FOREGROUND] and `BACKGROUND`. */
class UsageEvent(val kind: UsageEventKind, val packageName: String?, val timeMillis: Long) {
    override fun toString(): String = "UsageEvent"
}

/** Time spent in one app on one day. Minutes are whole minutes (rounded down). */
data class AppUsageEntry(val packageName: String, val foregroundMinutes: Int, val launchCount: Int) {
    override fun toString(): String = "AppUsageEntry"
}

/** One calendar day of usage as the contract carries it. [day] is `YYYY-MM-DD` in the child's local time zone. */
class DayUsage(
    val day: String,
    val totalScreenMinutes: Int,
    val unlockCount: Int,
    val apps: List<AppUsageEntry>,
    /** Apps that were measured but left out (over the cap, over one day in total, or an unusable package name). */
    val omittedCount: Int = 0,
) {
    override fun equals(other: Any?): Boolean =
        other is DayUsage && day == other.day && totalScreenMinutes == other.totalScreenMinutes &&
            unlockCount == other.unlockCount && apps == other.apps && omittedCount == other.omittedCount

    override fun hashCode(): Int =
        listOf(day, totalScreenMinutes, unlockCount, apps, omittedCount).hashCode()

    override fun toString(): String = "DayUsage"
}

/** The local calendar day and its boundaries. */
class LocalDay(val day: String, val startMillis: Long, val endMillis: Long) {
    override fun toString(): String = "LocalDay"
}

/**
 * Day boundaries in the child's time zone. The contract's `day` is the child's local date. The window end is the
 * start of the next local day, so a day is 23, 24 or 25 hours long around a daylight-saving change.
 */
object UsageDays {
    fun dayOf(epochMillis: Long, zone: ZoneId): LocalDay {
        val date: LocalDate = Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate()
        return of(date, zone)
    }

    fun previous(day: LocalDay, zone: ZoneId): LocalDay =
        of(LocalDate.parse(day.day).minusDays(1), zone)

    private fun of(date: LocalDate, zone: ZoneId): LocalDay = LocalDay(
        day = date.toString(),
        startMillis = date.atStartOfDay(zone).toInstant().toEpochMilli(),
        endMillis = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(),
    )
}

/**
 * Turns a time-ordered list of OS events into one day of usage. Pure, so every rule is JVM-tested.
 *
 * Rules:
 * - An app is in the foreground from its first `FOREGROUND` event until its `BACKGROUND` event. A second
 *   `FOREGROUND` for an app that is already in the foreground changes nothing (moving between two screens of the
 *   same app is not a new launch). Each new foreground interval is one launch.
 * - A `BACKGROUND` event with no matching start (the app was already open when the day began) is ignored: that
 *   part of the day is not counted, so the numbers can only be too low, never too high.
 * - Screen off closes every open interval at that moment. At the end of the window, open intervals close at
 *   [windowEndMillis] (the caller passes "now" for today).
 * - Screen time is the time the screen was on. A leading `SCREEN_OFF` means the screen was on since the day
 *   began. Without any screen events it falls back to the summed app time.
 * - Unlocks are the `UNLOCK` events.
 * - Events outside `[windowStartMillis, windowEndMillis]` are ignored.
 */
object UsageEventAggregator {
    private const val MILLIS_PER_MINUTE = 60_000L

    fun aggregate(
        events: List<UsageEvent>,
        day: String,
        windowStartMillis: Long,
        windowEndMillis: Long,
    ): DayUsage {
        val open = HashMap<String, Long>()
        val millis = LinkedHashMap<String, Long>()
        val launches = HashMap<String, Int>()
        var unlocks = 0
        var screenOnSince: Long? = null
        var screenMillis = 0L
        var sawScreenEvent = false

        fun closeApp(pkg: String, at: Long) {
            val start = open.remove(pkg) ?: return
            if (at > start) millis[pkg] = (millis[pkg] ?: 0L) + (at - start)
        }

        for (event in events.sortedBy { it.timeMillis }) {
            val t = event.timeMillis
            if (t < windowStartMillis || t > windowEndMillis) continue
            when (event.kind) {
                UsageEventKind.FOREGROUND -> {
                    val pkg = event.packageName ?: continue
                    if (pkg !in open) {
                        open[pkg] = t
                        launches[pkg] = (launches[pkg] ?: 0) + 1
                    }
                }
                UsageEventKind.BACKGROUND -> event.packageName?.let { closeApp(it, t) }
                UsageEventKind.SCREEN_ON -> {
                    if (!sawScreenEvent) sawScreenEvent = true
                    if (screenOnSince == null) screenOnSince = t
                }
                UsageEventKind.SCREEN_OFF -> {
                    if (!sawScreenEvent) {
                        sawScreenEvent = true
                        screenOnSince = windowStartMillis
                    }
                    screenOnSince?.let { screenMillis += t - it }
                    screenOnSince = null
                    open.keys.toList().forEach { closeApp(it, t) }
                }
                UsageEventKind.UNLOCK -> unlocks++
            }
        }
        open.keys.toList().forEach { closeApp(it, windowEndMillis) }
        screenOnSince?.let { screenMillis += windowEndMillis - it }

        val apps = (millis.keys + launches.keys).toSortedSet().map { pkg ->
            AppUsageEntry(pkg, ((millis[pkg] ?: 0L) / MILLIS_PER_MINUTE).toInt(), launches[pkg] ?: 0)
        }
        val fallback = millis.values.sum()
        val totalMillis = if (sawScreenEvent) screenMillis else fallback
        val total = (totalMillis / MILLIS_PER_MINUTE).coerceAtMost(UsageLimits.MAX_MINUTES.toLong()).toInt()
        return DayUsage(day, total, unlocks, apps)
    }
}

/**
 * Makes a [DayUsage] acceptable to the contract; never the other way round (the server answers a permanent 400 for
 * a violation, so nothing is left to chance). Rules mirror the Zod schema: day is a real `YYYY-MM-DD`, minutes
 * 0..1440, counts 0..10000, package names valid and unique (the larger values win), at most 200 apps, app minutes
 * summing to at most one day.
 *
 * **Cap decision:** apps are ranked by minutes (then launches, then package name), apps with neither minutes nor
 * launches are dropped, and the ranked list is taken while the running minute sum stays within 1440 and at most 200
 * apps are kept. What does not fit is counted in `omittedCount` and shown to the child.
 */
object UsageSanitizer {
    private val packageRegex = Regex(AppInventoryLimits.PACKAGE_PATTERN)
    private val dayRegex = Regex("""^\d{4}-\d{2}-\d{2}$""")

    private val ranking = compareByDescending<AppUsageEntry> { it.foregroundMinutes }
        .thenByDescending { it.launchCount }
        .thenBy { it.packageName }

    /** Null when [DayUsage.day] is not a real calendar date. */
    fun sanitize(raw: DayUsage): DayUsage? {
        if (!isRealDate(raw.day)) return null
        var invalid = 0
        val merged = LinkedHashMap<String, AppUsageEntry>()
        for (app in raw.apps) {
            if (app.packageName.length > UsageLimits.PACKAGE_MAX || !packageRegex.matches(app.packageName)) {
                invalid++
                continue
            }
            val clean = AppUsageEntry(
                app.packageName,
                app.foregroundMinutes.coerceIn(0, UsageLimits.MAX_MINUTES),
                app.launchCount.coerceIn(0, UsageLimits.MAX_COUNT),
            )
            val old = merged[clean.packageName]
            merged[clean.packageName] = if (old == null) {
                clean
            } else {
                AppUsageEntry(
                    clean.packageName,
                    maxOf(old.foregroundMinutes, clean.foregroundMinutes),
                    maxOf(old.launchCount, clean.launchCount),
                )
            }
        }
        val ranked = merged.values.filter { it.foregroundMinutes > 0 || it.launchCount > 0 }.sortedWith(ranking)
        val kept = ArrayList<AppUsageEntry>()
        var sum = 0
        var skipped = merged.size - ranked.size
        for (app in ranked) {
            if (kept.size < UsageLimits.MAX_APPS && sum + app.foregroundMinutes <= UsageLimits.MAX_MINUTES) {
                kept += app
                sum += app.foregroundMinutes
            } else {
                skipped++
            }
        }
        return DayUsage(
            day = raw.day,
            totalScreenMinutes = raw.totalScreenMinutes.coerceIn(0, UsageLimits.MAX_MINUTES),
            unlockCount = raw.unlockCount.coerceIn(0, UsageLimits.MAX_COUNT),
            apps = kept,
            omittedCount = raw.omittedCount + invalid + skipped,
        )
    }

    fun isRealDate(value: String): Boolean {
        if (!dayRegex.matches(value)) return false
        return try {
            LocalDate.parse(value).toString() == value
        } catch (_: Exception) {
            false
        }
    }
}

/** Reads the OS events of one local day. May throw; the runner treats that as "nothing to send". */
fun interface UsageEventsSource {
    fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent>
}

/** What the child's screen shows: exactly what the server last acknowledged for the most recent day, and when. */
class UsageReport(val usage: DayUsage, val sentAtEpochMillis: Long) {
    override fun toString(): String = "UsageReport"
}

/**
 * Single-string form of a [UsageReport] for the sealed store. Records are separated by U+001E, fields by U+001F
 * (control characters that never occur in a valid package name or day). First record: `v1`, sent-at millis, day,
 * total minutes, unlocks, omitted count. Then one record per app: package, minutes, launches. [decode] only
 * accepts what [encode] writes and what [UsageSanitizer] would produce, so damaged storage reads as "nothing sent".
 */
object UsageReportCodec {
    private const val FIELD = '\u001f'
    private const val RECORD = '\u001e'
    private const val VERSION_TAG = "v1"
    private const val HEADER_FIELDS = 6
    private const val APP_FIELDS = 3
    private const val OMITTED_MAX = 1_000_000

    fun encode(report: UsageReport): String {
        val u = report.usage
        val header = listOf(
            VERSION_TAG, report.sentAtEpochMillis.toString(), u.day,
            u.totalScreenMinutes.toString(), u.unlockCount.toString(), u.omittedCount.toString(),
        ).joinToString(FIELD.toString())
        val rows = u.apps.map {
            listOf(it.packageName, it.foregroundMinutes.toString(), it.launchCount.toString())
                .joinToString(FIELD.toString())
        }
        return (listOf(header) + rows).joinToString(RECORD.toString())
    }

    fun decode(text: String?): UsageReport? {
        val records = text?.split(RECORD) ?: return null
        val header = records.first().split(FIELD)
        if (header.size != HEADER_FIELDS || header[0] != VERSION_TAG) return null
        val sentAt = header[1].toLongOrNull()?.takeIf { it > 0 } ?: return null
        val day = header[2].takeIf(UsageSanitizer::isRealDate) ?: return null
        val total = header[3].toIntOrNull()?.takeIf { it in 0..UsageLimits.MAX_MINUTES } ?: return null
        val unlocks = header[4].toIntOrNull()?.takeIf { it in 0..UsageLimits.MAX_COUNT } ?: return null
        val omitted = header[5].toIntOrNull()?.takeIf { it in 0..OMITTED_MAX } ?: return null
        if (records.size - 1 > UsageLimits.MAX_APPS) return null
        val apps = ArrayList<AppUsageEntry>(records.size - 1)
        for (record in records.drop(1)) apps += decodeApp(record) ?: return null
        val usage = DayUsage(day, total, unlocks, apps, omitted)
        // What was acknowledged was sanitized: re-sanitizing must change nothing.
        if (UsageSanitizer.sanitize(usage) != usage) return null
        return UsageReport(usage, sentAt)
    }

    private fun decodeApp(record: String): AppUsageEntry? {
        val parts = record.split(FIELD)
        if (parts.size != APP_FIELDS) return null
        val minutes = parts[1].toIntOrNull() ?: return null
        val launches = parts[2].toIntOrNull() ?: return null
        return AppUsageEntry(parts[0], minutes, launches)
    }
}

/** When an extra upload is worth doing in addition to the 6-hour job, and what the two-day upload covers. */
object UsagePolicy {
    private const val MILLIS_PER_MINUTE = 60_000L

    /**
     * On app resume: only with Usage Access switched on, and then when nothing was acknowledged yet or the last
     * acknowledged upload is at least [UsageLimits.RESUME_MIN_AGE_MINUTES] old (the server allows 12 per hour).
     * A clock that went backwards counts as "due".
     */
    fun needsUploadNow(access: UsageAccess, last: UsageReport?, nowEpochMillis: Long): Boolean {
        if (access != UsageAccess.GRANTED) return false
        if (last == null) return true
        val age = nowEpochMillis - last.sentAtEpochMillis
        return age < 0 || age >= UsageLimits.RESUME_MIN_AGE_MINUTES * MILLIS_PER_MINUTE
    }

    /**
     * Yesterday is sent once more on the first upload of a new local day, so its last hours (after the final upload
     * of that day) are not lost. The server keeps the larger value per column, so a repeat is harmless.
     */
    fun includesYesterday(last: UsageReport?, today: String): Boolean = last == null || last.usage.day != today
}
