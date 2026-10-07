package app.familysafe.child.domain

import java.time.Instant
import java.time.ZoneId

/** Why no schedule check result is available. */
enum class ScheduleInactiveReason {
    /** No rules cached yet (never pulled, or disconnected). */
    NO_RULES,

    /** The cached rules were not confirmed for over a week and are no longer applied. */
    RULES_EXPIRED,

    /** The parent has no enabled schedule. */
    NO_SCHEDULES,
}

/** The latest result of the on-device schedule check. Memory only: derived locally, never stored, never sent. */
sealed interface ScheduleStatus {
    /** Nothing checked yet in this app run. */
    data object Unchecked : ScheduleStatus

    class Inactive(val reason: ScheduleInactiveReason, val checkedAtEpochMillis: Long) : ScheduleStatus {
        override fun equals(other: Any?): Boolean =
            other is Inactive && other.reason == reason && other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = 31 * reason.hashCode() + checkedAtEpochMillis.hashCode()

        override fun toString(): String = "ScheduleStatus.Inactive($reason)"
    }

    class Active(
        /** How many enabled windows the parent has set (in force now or not). */
        val scheduleCount: Int,
        /** Windows in force at [checkedAtEpochMillis], BEDTIME first. Empty = nothing scheduled right now. */
        val active: List<ActiveWindow>,
        /** The next instant a window starts or ends; null only when there are no windows. */
        val nextBoundaryEpochMillis: Long?,
        /** IANA id of the zone the times were read in (the parent's, or this phone's own). */
        val zoneId: String,
        /** The parent set this zone (false = the phone's own zone is used). */
        val parentZone: Boolean,
        /** The rules were not confirmed for a while (still applied). */
        val rulesStale: Boolean,
        val checkedAtEpochMillis: Long,
    ) : ScheduleStatus {
        val isQuiet: Boolean get() = active.isNotEmpty()

        override fun equals(other: Any?): Boolean = other is Active &&
            other.scheduleCount == scheduleCount &&
            other.active == active &&
            other.nextBoundaryEpochMillis == nextBoundaryEpochMillis &&
            other.zoneId == zoneId &&
            other.parentZone == parentZone &&
            other.rulesStale == rulesStale &&
            other.checkedAtEpochMillis == checkedAtEpochMillis

        override fun hashCode(): Int = listOf(
            scheduleCount,
            active,
            nextBoundaryEpochMillis,
            zoneId,
            parentZone,
            rulesStale,
            checkedAtEpochMillis,
        ).hashCode()

        override fun toString(): String = "ScheduleStatus.Active(${active.size} of $scheduleCount)"
    }
}

/** Builds a [ScheduleStatus] from the cached rules, the clock and the phone's zone. */
object ScheduleStatusEvaluator {
    fun read(cached: CachedScreenTimeConfig?, nowEpochMillis: Long, deviceZone: ZoneId): ScheduleStatus {
        if (cached == null) return ScheduleStatus.Inactive(ScheduleInactiveReason.NO_RULES, nowEpochMillis)
        val config = cached.activeConfig(nowEpochMillis)
            ?: return ScheduleStatus.Inactive(ScheduleInactiveReason.RULES_EXPIRED, nowEpochMillis)
        if (config.schedules.isEmpty()) {
            return ScheduleStatus.Inactive(ScheduleInactiveReason.NO_SCHEDULES, nowEpochMillis)
        }
        val zone = ScheduleEvaluator.zoneFor(config.timezone, deviceZone)
        val state = ScheduleEvaluator.evaluate(config.schedules, zone, Instant.ofEpochMilli(nowEpochMillis))
        return ScheduleStatus.Active(
            scheduleCount = config.schedules.size,
            active = state.active,
            nextBoundaryEpochMillis = state.nextBoundary?.toEpochMilli(),
            zoneId = zone.id,
            parentZone = config.timezone != null && zone.id == config.timezone,
            rulesStale = cached.freshness(nowEpochMillis) == ConfigFreshness.STALE,
            checkedAtEpochMillis = nowEpochMillis,
        )
    }
}

/**
 * The "quiet time" notice for the child: a window that is in force and was not put away yet. Dismissed per window
 * and per day (a new day, or a parent edit of the times, shows it again). The app only informs: it cannot lock the
 * phone or close other apps (Track A).
 */
object QuietTimeNotices {
    fun dismissKey(active: ActiveWindow): String =
        "${active.startDate}:${active.window.id}:${active.window.startMinute}-${active.window.endMinute}"

    fun pending(status: ScheduleStatus, dismissedKeys: String): ActiveWindow? =
        (status as? ScheduleStatus.Active)?.active?.firstOrNull {
            !NoticeKeys.contains(dismissedKeys, dismissKey(it))
        }
}

/** When the one-off WorkManager job that re-checks the schedules should run. No exact alarm, so it may run late. */
object ScheduleBoundary {
    /** Added to the boundary so the re-check lands just after it, never just before. */
    const val SLACK_MILLIS = 1_000L

    /** Delay until the next boundary, or null when there is nothing to wait for (no windows, no rules). */
    fun nextDelayMillis(status: ScheduleStatus, nowEpochMillis: Long): Long? {
        val next = (status as? ScheduleStatus.Active)?.nextBoundaryEpochMillis ?: return null
        return (next - nowEpochMillis).coerceAtLeast(0L) + SLACK_MILLIS
    }
}
