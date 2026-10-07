package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId

/** Timing constants of the on-device limit check. */
object LimitCheckTimings {
    /** While the app is on screen the check repeats this often (one local usage read; nothing is sent). */
    const val FOREGROUND_TICK_MILLIS = 60_000L

    /** The "almost there" notice covers the last sixth of the limit, but never more than this many minutes. */
    const val WARN_WINDOW_MAX_MINUTES = 10

    const val WARN_WINDOW_DIVISOR = 6
}

/** Rule-engine state (prompt §31). BLOCK does not exist on Track A: the app can inform, it cannot lock the phone. */
enum class LimitLevel { ALLOW, WARN, LIMIT }

/** Today's screen time measured against today's limit. [day] is the device-local date (`YYYY-MM-DD`). */
class ScreenTimeEvaluation(
    val level: LimitLevel,
    val day: String,
    val isoWeekday: Int,
    val usedMinutes: Int,
    val limitMinutes: Int,
) {
    val remainingMinutes: Int get() = (limitMinutes - usedMinutes).coerceAtLeast(0)

    /** The parent set 0 minutes for this weekday ("no screen time"). */
    val noScreenTimeToday: Boolean get() = limitMinutes == 0

    override fun equals(other: Any?): Boolean = other is ScreenTimeEvaluation &&
        other.level == level &&
        other.day == day &&
        other.isoWeekday == isoWeekday &&
        other.usedMinutes == usedMinutes &&
        other.limitMinutes == limitMinutes

    override fun hashCode(): Int = listOf(level, day, isoWeekday, usedMinutes, limitMinutes).hashCode()

    override fun toString(): String = "ScreenTimeEvaluation($level)"
}

/**
 * ALLOW / WARN / LIMIT for one weekday. Server authoritative: the limit comes from the cached config only. Example
 * with a 60 minute limit: 0..49 ALLOW, 50..59 WARN, 60 and more LIMIT. A limit of 0 is LIMIT from the first minute.
 */
object ScreenTimeRuleEngine {
    /** First used minute that is WARN for [limitMinutes] (always at least 1 and below the limit when there is room). */
    fun warnStartMinutes(limitMinutes: Int): Int {
        val window = (limitMinutes / LimitCheckTimings.WARN_WINDOW_DIVISOR)
            .coerceIn(1, LimitCheckTimings.WARN_WINDOW_MAX_MINUTES)
        return (limitMinutes - window).coerceAtLeast(1)
    }

    /** Null when the config has no limit for [isoWeekday]. Negative usage reads as zero. */
    fun evaluate(config: ScreenTimeConfig, day: String, isoWeekday: Int, usedMinutes: Int): ScreenTimeEvaluation? {
        val limit = config.limitFor(isoWeekday) ?: return null
        val used = usedMinutes.coerceAtLeast(0)
        val level = when {
            used >= limit -> LimitLevel.LIMIT
            used >= warnStartMinutes(limit) -> LimitLevel.WARN
            else -> LimitLevel.ALLOW
        }
        return ScreenTimeEvaluation(level, day, isoWeekday, used, limit)
    }
}

/** Why no limit is being checked right now. Each reason has its own plain-words line for the child. */
enum class LimitInactiveReason {
    /** No rules received (or the device is not enrolled / was disconnected). */
    NO_RULES,

    /** The cached rules were not confirmed for over a week and are not applied. */
    RULES_EXPIRED,

    /** Rules exist, but none sets a limit for today's weekday. */
    NO_LIMIT_TODAY,

    /** A limit applies today, but Usage Access is off, so screen time cannot be measured. */
    NO_USAGE_ACCESS,

    /** Usage Access is on but Android did not return usable data this time. */
    CANNOT_READ_USAGE,
}

/** The latest result of the on-device limit check. Memory only: never stored, never sent. */
sealed interface LimitStatus {
    /** Nothing checked yet in this app run. */
    data object Unchecked : LimitStatus

    class Inactive(val reason: LimitInactiveReason, val checkedAtEpochMillis: Long) : LimitStatus {
        override fun equals(other: Any?): Boolean =
            other is Inactive && other.reason == reason && other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = 31 * reason.hashCode() + checkedAtEpochMillis.hashCode()

        override fun toString(): String = "LimitStatus.Inactive($reason)"
    }

    class Active(
        val evaluation: ScreenTimeEvaluation,
        /** The rules were not confirmed for a while (still applied). */
        val rulesStale: Boolean,
        val checkedAtEpochMillis: Long,
    ) : LimitStatus {
        override fun equals(other: Any?): Boolean = other is Active &&
            other.evaluation == evaluation &&
            other.rulesStale == rulesStale &&
            other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = listOf(evaluation, rulesStale, checkedAtEpochMillis).hashCode()

        override fun toString(): String = "LimitStatus.Active(${evaluation.level})"
    }
}

/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in the device's own time zone. */
object LocalWeekday {
    fun iso(epochMillis: Long, zone: ZoneId): Int = Instant.ofEpochMilli(epochMillis).atZone(zone).dayOfWeek.value
}

/** Builds a [LimitStatus] from the cached rules, the Usage Access switch and the local usage events. */
object LimitStatusEvaluator {
    @Suppress("LongParameterList")
    fun evaluate(
        cached: CachedScreenTimeConfig?,
        access: UsageAccess,
        source: UsageEventsSource,
        nowEpochMillis: Long,
        zone: ZoneId,
    ): LimitStatus {
        if (cached == null) return LimitStatus.Inactive(LimitInactiveReason.NO_RULES, nowEpochMillis)
        val config = cached.activeConfig(nowEpochMillis)
            ?: return LimitStatus.Inactive(LimitInactiveReason.RULES_EXPIRED, nowEpochMillis)
        val weekday = LocalWeekday.iso(nowEpochMillis, zone)
        if (config.limitFor(weekday) == null) {
            return LimitStatus.Inactive(LimitInactiveReason.NO_LIMIT_TODAY, nowEpochMillis)
        }
        if (access != UsageAccess.GRANTED) {
            return LimitStatus.Inactive(LimitInactiveReason.NO_USAGE_ACCESS, nowEpochMillis)
        }
        val day = UsageDays.dayOf(nowEpochMillis, zone)
        val used = try {
            // Same reading as the usage upload: the window of today ends now, so open apps count up to this moment.
            val end = minOf(day.endMillis, nowEpochMillis)
            val events = source.events(day.startMillis, end)
            UsageEventAggregator.aggregate(events, day.day, day.startMillis, end).totalScreenMinutes
        } catch (_: Exception) {
            return LimitStatus.Inactive(LimitInactiveReason.CANNOT_READ_USAGE, nowEpochMillis)
        }
        val evaluation = ScreenTimeRuleEngine.evaluate(config, day.day, weekday, used)
            ?: return LimitStatus.Inactive(LimitInactiveReason.NO_LIMIT_TODAY, nowEpochMillis)
        val stale = cached.freshness(nowEpochMillis) == ConfigFreshness.STALE
        return LimitStatus.Active(evaluation, stale, nowEpochMillis)
    }
}

/** When the full-screen "limit reached" notice is shown, and how the child puts it away for the rest of the day. */
object LimitNotice {
    /** The notice is dismissed per day and per limit: a new day, or a different limit, shows it again. */
    fun dismissKey(evaluation: ScreenTimeEvaluation): String = "${evaluation.day}:${evaluation.limitMinutes}"

    fun showsFullScreen(status: LimitStatus, dismissedKey: String?): Boolean {
        if (status !is LimitStatus.Active) return false
        val evaluation = status.evaluation
        return evaluation.level == LimitLevel.LIMIT && dismissKey(evaluation) != dismissedKey
    }
}
