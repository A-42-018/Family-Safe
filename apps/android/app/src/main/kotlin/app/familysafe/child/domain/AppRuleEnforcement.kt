package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Per-app level (prompt §31). BLOCKED means the parent blocked the app. Track A cannot close or lock anything:
 * the app only notices and informs (and tells the parent a blocked app was opened). Hard blocking is Track B.
 */
enum class AppRuleLevel { ALLOW, WARN, LIMIT, BLOCKED }

/** One restricted app measured against today's usage. [limitMinutes] is null while the app is blocked. */
class AppRuleEvaluation(
    val packageName: String,
    val level: AppRuleLevel,
    val usedMinutes: Int,
    val launchesToday: Int,
    val limitMinutes: Int?,
) {
    /** The app was in the foreground at least once today (minutes or a launch). */
    val openedToday: Boolean get() = usedMinutes > 0 || launchesToday > 0

    override fun equals(other: Any?): Boolean = other is AppRuleEvaluation &&
        other.packageName == packageName &&
        other.level == level &&
        other.usedMinutes == usedMinutes &&
        other.launchesToday == launchesToday &&
        other.limitMinutes == limitMinutes

    override fun hashCode(): Int = listOf(packageName, level, usedMinutes, launchesToday, limitMinutes).hashCode()

    override fun toString(): String = "AppRuleEvaluation($level)"
}

/** Same warn window as the screen-time limit, so a 60 minute app limit warns at minute 50. */
object AppRuleEngine {
    fun evaluate(rule: AppRule, usage: AppUsageEntry?): AppRuleEvaluation {
        val used = (usage?.foregroundMinutes ?: 0).coerceAtLeast(0)
        val launches = (usage?.launchCount ?: 0).coerceAtLeast(0)
        if (rule.blocked) return AppRuleEvaluation(rule.packageName, AppRuleLevel.BLOCKED, used, launches, null)
        val limit = rule.dailyLimitMinutes
            ?: return AppRuleEvaluation(rule.packageName, AppRuleLevel.ALLOW, used, launches, null)
        val level = when {
            used >= limit -> AppRuleLevel.LIMIT
            used >= ScreenTimeRuleEngine.warnStartMinutes(limit) -> AppRuleLevel.WARN
            else -> AppRuleLevel.ALLOW
        }
        return AppRuleEvaluation(rule.packageName, level, used, launches, limit)
    }

    /** One evaluation per rule, blocked apps first, then by package. Only packages with a rule are looked at. */
    fun evaluateAll(rules: List<AppRule>, usage: List<AppUsageEntry>): List<AppRuleEvaluation> {
        val byPackage = usage.associateBy { it.packageName }
        return rules.map { evaluate(it, byPackage[it.packageName]) }
            .sortedWith(compareBy<AppRuleEvaluation> { it.level != AppRuleLevel.BLOCKED }.thenBy { it.packageName })
    }
}

/** Why no app rule is being checked right now. Each reason has its own plain-words line for the child. */
enum class AppRuleInactiveReason {
    /** No rules received (or the device is not enrolled / was disconnected). */
    NO_RULES,

    /** The cached rules were not confirmed for over a week and are not applied. */
    RULES_EXPIRED,

    /** Rules exist, but none restricts an app. */
    NO_APP_RULES,

    /** App rules exist, but Usage Access is off, so the app cannot see which app was opened. */
    NO_USAGE_ACCESS,

    /** Usage Access is on but Android did not return usable data this time. */
    CANNOT_READ_USAGE,
}

/** The latest result of the on-device app-rule check. Memory only: never stored, never sent. */
sealed interface AppRuleStatus {
    /** Nothing checked yet in this app run. */
    data object Unchecked : AppRuleStatus

    class Inactive(val reason: AppRuleInactiveReason, val checkedAtEpochMillis: Long) : AppRuleStatus {
        override fun equals(other: Any?): Boolean =
            other is Inactive && other.reason == reason && other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = 31 * reason.hashCode() + checkedAtEpochMillis.hashCode()

        override fun toString(): String = "AppRuleStatus.Inactive($reason)"
    }

    class Active(
        /** Device-local date (`YYYY-MM-DD`) the numbers belong to. */
        val day: String,
        val entries: List<AppRuleEvaluation>,
        /** The rules were not confirmed for a while (still applied). */
        val rulesStale: Boolean,
        val checkedAtEpochMillis: Long,
    ) : AppRuleStatus {
        override fun equals(other: Any?): Boolean = other is Active &&
            other.day == day &&
            other.entries == entries &&
            other.rulesStale == rulesStale &&
            other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = listOf(day, entries, rulesStale, checkedAtEpochMillis).hashCode()

        override fun toString(): String = "AppRuleStatus.Active(${entries.size})"
    }
}

/** What one check read: the status and the raw events (the attempt detector reuses them; no second read). */
class AppRuleReading(
    val status: AppRuleStatus,
    val events: List<UsageEvent>,
    /** The rules the reading was made with; null when no rules applied. */
    val config: ScreenTimeConfig?,
) {
    override fun toString(): String = "AppRuleReading"
}

/** Builds an [AppRuleStatus] from the cached rules, the Usage Access switch and the local usage events. */
object AppRuleStatusEvaluator {
    @Suppress("LongParameterList")
    fun read(
        cached: CachedScreenTimeConfig?,
        access: UsageAccess,
        source: UsageEventsSource,
        nowEpochMillis: Long,
        zone: ZoneId,
        scanFromEpochMillis: Long,
    ): AppRuleReading {
        fun inactive(reason: AppRuleInactiveReason, config: ScreenTimeConfig? = null) =
            AppRuleReading(AppRuleStatus.Inactive(reason, nowEpochMillis), emptyList(), config)

        if (cached == null) return inactive(AppRuleInactiveReason.NO_RULES)
        val config = cached.activeConfig(nowEpochMillis) ?: return inactive(AppRuleInactiveReason.RULES_EXPIRED)
        if (config.appRules.isEmpty()) return inactive(AppRuleInactiveReason.NO_APP_RULES, config)
        if (access != UsageAccess.GRANTED) return inactive(AppRuleInactiveReason.NO_USAGE_ACCESS, config)
        val day = UsageDays.dayOf(nowEpochMillis, zone)
        val end = minOf(day.endMillis, nowEpochMillis)
        val events = try {
            // Today for the minutes; further back (never beyond what the server accepts) for opened-app detection.
            source.events(minOf(day.startMillis, scanFromEpochMillis), end)
        } catch (_: Exception) {
            return inactive(AppRuleInactiveReason.CANNOT_READ_USAGE, config)
        }
        // The aggregator ignores events outside today's window, so the wider read cannot change the minutes.
        val usage = UsageEventAggregator.aggregate(events, day.day, day.startMillis, end)
        val entries = AppRuleEngine.evaluateAll(config.appRules, usage.apps)
        val stale = cached.freshness(nowEpochMillis) == ConfigFreshness.STALE
        return AppRuleReading(AppRuleStatus.Active(day.day, entries, stale, nowEpochMillis), events, config)
    }
}

/** A restricted app that was opened today and has reached its rule: the full-screen notice for the child. */
class AppRuleNotice(
    val packageName: String,
    val level: AppRuleLevel,
    val day: String,
    val limitMinutes: Int?,
    val usedMinutes: Int,
) {
    /** Dismissed per day, per package and per rule: a new day or a changed rule shows it again. */
    val dismissKey: String get() = "$day:$packageName:$level:${limitMinutes ?: "-"}"

    override fun toString(): String = "AppRuleNotice($level)"
}

object AppRuleNotices {
    /** Blocked apps first, then limits; only apps that were really opened today. */
    fun all(status: AppRuleStatus): List<AppRuleNotice> {
        if (status !is AppRuleStatus.Active) return emptyList()
        return status.entries
            .filter { (it.level == AppRuleLevel.BLOCKED || it.level == AppRuleLevel.LIMIT) && it.openedToday }
            .map { AppRuleNotice(it.packageName, it.level, status.day, it.limitMinutes, it.usedMinutes) }
    }

    /** The first notice the child has not put away yet, or null. [dismissed] is the string from [NoticeKeys]. */
    fun pending(status: AppRuleStatus, dismissed: String): AppRuleNotice? =
        all(status).firstOrNull { !NoticeKeys.contains(dismissed, it.dismissKey) }
}

/** Dismissed notice keys as one string, so Compose can keep them in `rememberSaveable` (newline separated). */
object NoticeKeys {
    private const val SEPARATOR = "\n"
    private const val MAX_KEYS = 50

    fun contains(joined: String, key: String): Boolean = joined.split(SEPARATOR).contains(key)

    /** Adds [key]; keeps the newest [MAX_KEYS] so the string cannot grow without bound. */
    fun add(joined: String, key: String): String {
        if (contains(joined, key)) return joined
        val keys = joined.split(SEPARATOR).filter { it.isNotEmpty() } + key
        return keys.takeLast(MAX_KEYS).joinToString(SEPARATOR)
    }
}

/** A blocked app seen in the foreground, with the time (epoch milliseconds) of the event. */
data class AppAttempt(val packageName: String, val occurredAtEpochMillis: Long) {
    override fun toString(): String = "AppAttempt"
}

/**
 * Detection bookkeeping, kept in the sealed store: which rule version it belongs to, how far events were looked at
 * ([watermarkMillis]), when each package was last counted (de-duplication) and attempts waiting for an upload.
 */
data class AppAttemptState(
    val rulesVersion: Int? = null,
    val watermarkMillis: Long? = null,
    val lastSeen: Map<String, Long> = emptyMap(),
    val pending: List<AppAttempt> = emptyList(),
) {
    override fun toString(): String = "AppAttemptState"
}

/**
 * Counts a BLOCKED_APP_ATTEMPT when a blocked app comes to the foreground after the device knew about the rule.
 *
 * - Only events strictly after the watermark and not after "now" count; the watermark moves to "now" on every check.
 * - A new rule version resets the watermark to "now" without scanning: opening an app before the device received
 *   the rule is not an attempt.
 * - The same package is counted at most once per [AppRuleLimits.ATTEMPT_DEDUPE_SECONDS] (the server does the same).
 * - Never looks back further than [AppRuleLimits.SCAN_MAX_MILLIS].
 */
object AppAttemptDetector {
    private const val DEDUPE_MILLIS = AppRuleLimits.ATTEMPT_DEDUPE_SECONDS * 1_000L

    /** Where a check should start reading events from. */
    fun scanFrom(state: AppAttemptState, nowEpochMillis: Long): Long {
        val earliest = nowEpochMillis - AppRuleLimits.SCAN_MAX_MILLIS
        return maxOf(state.watermarkMillis ?: nowEpochMillis, earliest)
    }

    /** Nothing applies right now (rules expired or no app rules): move on without counting anything. */
    fun advance(state: AppAttemptState, nowEpochMillis: Long): AppAttemptState =
        state.copy(watermarkMillis = nowEpochMillis)

    fun detect(
        state: AppAttemptState,
        rulesVersion: Int,
        blocked: Set<String>,
        events: List<UsageEvent>,
        nowEpochMillis: Long,
    ): AppAttemptState {
        val watermark = state.watermarkMillis
        if (state.rulesVersion != rulesVersion || watermark == null || watermark > nowEpochMillis) {
            return state.copy(rulesVersion = rulesVersion, watermarkMillis = nowEpochMillis)
        }
        val from = maxOf(watermark, nowEpochMillis - AppRuleLimits.SCAN_MAX_MILLIS)
        val lastSeen = LinkedHashMap(state.lastSeen)
        val pending = ArrayList(state.pending)
        for (event in events.sortedBy { it.timeMillis }) {
            if (event.kind != UsageEventKind.FOREGROUND) continue
            val pkg = event.packageName ?: continue
            if (pkg !in blocked) continue
            val t = event.timeMillis
            if (t <= from || t > nowEpochMillis) continue
            val last = lastSeen[pkg]
            if (last != null && t - last < DEDUPE_MILLIS) continue
            lastSeen[pkg] = t
            pending += AppAttempt(pkg, t)
        }
        return AppAttemptState(
            rulesVersion = rulesVersion,
            watermarkMillis = nowEpochMillis,
            lastSeen = trimLastSeen(lastSeen),
            pending = pending.takeLast(AppRuleLimits.OUTBOX_MAX),
        )
    }

    private fun trimLastSeen(lastSeen: Map<String, Long>): Map<String, Long> {
        if (lastSeen.size <= AppRuleLimits.LAST_SEEN_MAX) return lastSeen
        return lastSeen.entries.sortedByDescending { it.value }.take(AppRuleLimits.LAST_SEEN_MAX)
            .associate { it.key to it.value }
    }
}

/** Single-string form of [AppAttemptState]: `v1;rulesVersion;watermark;lastSeen;pending` (`pkg=ms,pkg=ms`). */
object AppAttemptStateCodec {
    private const val FIELDS = 5
    private const val VERSION_TAG = "v1"
    private val PACKAGE = Regex(AppInventoryLimits.PACKAGE_PATTERN)

    fun encode(state: AppAttemptState): String = listOf(
        VERSION_TAG,
        state.rulesVersion?.toString().orEmpty(),
        state.watermarkMillis?.toString().orEmpty(),
        state.lastSeen.entries.joinToString(",") { "${it.key}=${it.value}" },
        state.pending.joinToString(",") { "${it.packageName}=${it.occurredAtEpochMillis}" },
    ).joinToString(";")

    /** Null for anything [encode] would not write; the caller then starts from an empty state. */
    fun decode(text: String?): AppAttemptState? {
        val parts = text?.split(";") ?: return null
        if (parts.size != FIELDS || parts[0] != VERSION_TAG) return null
        val version = parts[1].ifEmpty { null }?.let { it.toIntOrNull() ?: return null }
        val watermark = parts[2].ifEmpty { null }?.let { it.toLongOrNull()?.takeIf { v -> v > 0 } ?: return null }
        val lastSeen = linkedMapOf<String, Long>()
        for ((pkg, ms) in pairs(parts[3]) ?: return null) {
            if (lastSeen.put(pkg, ms) != null) return null
        }
        val pending = (pairs(parts[4]) ?: return null).map { AppAttempt(it.first, it.second) }
        if (lastSeen.size > AppRuleLimits.LAST_SEEN_MAX || pending.size > AppRuleLimits.OUTBOX_MAX) return null
        return AppAttemptState(version, watermark, lastSeen, pending)
    }

    private fun pairs(text: String): List<Pair<String, Long>>? {
        if (text.isEmpty()) return emptyList()
        val out = ArrayList<Pair<String, Long>>()
        for (item in text.split(",")) {
            val kv = item.split("=")
            if (kv.size != 2) return null
            val pkg = kv[0]
            if (pkg.length > AppInventoryLimits.PACKAGE_MAX || !PACKAGE.matches(pkg)) return null
            val ms = kv[1].toLongOrNull()?.takeIf { it > 0 } ?: return null
            out += pkg to ms
        }
        return out
    }
}

/** Which attempts go into one upload, and how a time is written on the wire. */
object AppAttemptBatch {
    private const val PAST_MILLIS =
        (
            AppRuleLimits.EVENT_PAST_SECONDS - AppRuleLimits.EVENT_EDGE_MARGIN_SECONDS -
                AppRuleLimits.EVENT_CLIENT_MARGIN_SECONDS
            ) * 1_000L

    /** Attempts the server could still accept (not too old), with times in the future pulled back to "now". */
    fun usable(pending: List<AppAttempt>, nowEpochMillis: Long): List<AppAttempt> = pending
        .filter { nowEpochMillis - it.occurredAtEpochMillis <= PAST_MILLIS }
        .map { if (it.occurredAtEpochMillis > nowEpochMillis) AppAttempt(it.packageName, nowEpochMillis) else it }
        .sortedBy { it.occurredAtEpochMillis }

    /** The oldest [AppRuleLimits.EVENTS_MAX] usable attempts. */
    fun next(pending: List<AppAttempt>, nowEpochMillis: Long): List<AppAttempt> =
        usable(pending, nowEpochMillis).take(AppRuleLimits.EVENTS_MAX)

    /** `2026-10-01T09:30:00Z`: UTC, whole seconds, the only form `APP_EVENT_TIME_PATTERN` accepts. */
    fun wireTime(epochMillis: Long): String =
        Instant.ofEpochMilli(epochMillis).truncatedTo(ChronoUnit.SECONDS).toString()
}

/** Names for the child-facing lists: the label from the app list the server last acknowledged, else the package. */
object AppRuleLabels {
    fun labelFor(packageName: String, inventory: AppInventoryReport?): String =
        inventory?.inventory?.apps?.firstOrNull { it.packageName == packageName }?.label?.takeIf { it.isNotBlank() }
            ?: packageName
}
