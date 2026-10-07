package app.familysafe.child.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Limits of the schedule list. The constants are checked against `device-config.ts` by a JVM drift test (19c-2). */
object ScheduleLimits {
    /** `SCHEDULES_MAX`. */
    const val MAX = 20

    /** `SCHEDULE_NAME_MAX`. */
    const val NAME_MAX = 100

    const val MINUTES_PER_DAY = 1_440
    const val MINUTES_PER_WEEK = 10_080
    const val ISO_WEEKDAYS = 7
}

/** `SCHEDULE_TYPES` in the contract. */
enum class ScheduleType {
    BEDTIME,
    SCHOOL,
    CUSTOM,
    ;

    companion object {
        fun parse(text: String): ScheduleType? = entries.firstOrNull { it.name == text }
    }
}

/**
 * One ENABLED window exactly as the device receives it (`scheduleSchema`). Semantics (same as the contract and SQL):
 * ISO weekdays (1 = Monday), minute resolution, `end < start` is overnight and belongs to the day it STARTS on, a
 * window running past Sunday midnight wraps into Monday, ranges are half-open (back-to-back windows do not overlap).
 * Built only through [validated]; `toString` never prints the parent-typed name.
 */
class ScheduleWindow private constructor(
    val id: String,
    val name: String,
    val type: ScheduleType,
    /** Ascending ISO weekdays the window STARTS on. */
    val days: List<Int>,
    val startMinute: Int,
    val endMinute: Int,
) {
    val isOvernight: Boolean get() = endMinute < startMinute

    val lengthMinutes: Int
        get() = if (endMinute > startMinute) {
            endMinute - startMinute
        } else {
            ScheduleLimits.MINUTES_PER_DAY - startMinute + endMinute
        }

    /** Half-open `[lo, hi)` minute ranges within one week (Monday 00:00 = 0); mirrors `scheduleWeekRanges`. */
    fun weekRanges(): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>()
        for (day in days) {
            val lo = (day - 1) * ScheduleLimits.MINUTES_PER_DAY + startMinute
            val hi = lo + lengthMinutes
            out += lo to minOf(hi, ScheduleLimits.MINUTES_PER_WEEK)
            if (hi > ScheduleLimits.MINUTES_PER_WEEK) out += 0 to (hi - ScheduleLimits.MINUTES_PER_WEEK)
        }
        return out
    }

    /** Do the two windows share any minute of the week? (Types are not compared.) */
    fun overlaps(other: ScheduleWindow): Boolean {
        val mine = weekRanges()
        val theirs = other.weekRanges()
        return mine.any { (alo, ahi) -> theirs.any { (blo, bhi) -> alo < bhi && blo < ahi } }
    }

    override fun equals(other: Any?): Boolean = other is ScheduleWindow &&
        other.id == id &&
        other.name == name &&
        other.type == type &&
        other.days == days &&
        other.startMinute == startMinute &&
        other.endMinute == endMinute

    override fun hashCode(): Int = listOf(id, name, type, days, startMinute, endMinute).hashCode()

    override fun toString(): String = "ScheduleWindow($type)"

    companion object {
        private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val HHMM = Regex("""^([01][0-9]|2[0-3]):([0-5][0-9])$""")
        private val CONTROL = Regex("[\\u0000-\\u001f\\u007f-\\u009f]")

        /** `HH:MM` to minutes after midnight; null when it is not exactly that shape. */
        fun minuteOf(hhmm: String): Int? {
            val m = HHMM.matchEntire(hhmm) ?: return null
            return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
        }

        /** Null when any value is outside what `scheduleSchema` allows. */
        fun validated(
            id: String,
            name: String,
            type: String,
            days: List<Int>,
            startTime: String,
            endTime: String,
        ): ScheduleWindow? {
            if (!UUID.matches(id)) return null
            val badName = name.isEmpty() || name.length > ScheduleLimits.NAME_MAX || name != name.trim()
            if (badName || CONTROL.containsMatchIn(name)) return null
            val parsedType = ScheduleType.parse(type) ?: return null
            if (days.isEmpty() || days.size > ScheduleLimits.ISO_WEEKDAYS) return null
            if (days.any { it !in 1..ScheduleLimits.ISO_WEEKDAYS }) return null
            if (days.zipWithNext().any { (a, b) -> a >= b }) return null
            val start = minuteOf(startTime) ?: return null
            val end = minuteOf(endTime) ?: return null
            if (start == end) return null
            return ScheduleWindow(id.lowercase(), name, parsedType, days.toList(), start, end)
        }
    }
}

/** The whole list of windows: at most [ScheduleLimits.MAX], unique ids, no overlap inside one type. */
object ScheduleList {
    /** Null when the list breaks any rule of `deviceConfigSchema`; otherwise a copy in the given order. */
    fun validated(windows: List<ScheduleWindow>): List<ScheduleWindow>? {
        if (windows.size > ScheduleLimits.MAX) return null
        if (windows.map { it.id }.toSet().size != windows.size) return null
        for ((i, a) in windows.withIndex()) {
            if (windows.take(i).any { b -> a.type == b.type && a.overlaps(b) }) return null
        }
        return windows.toList()
    }
}

/** A window that is in force at one instant. [startDate] is the device-zone date it STARTED on (overnight windows). */
class ActiveWindow(
    val window: ScheduleWindow,
    val startDate: LocalDate,
    val startsAt: Instant,
    val endsAt: Instant,
) {
    override fun equals(other: Any?): Boolean = other is ActiveWindow &&
        other.window == window &&
        other.startDate == startDate &&
        other.startsAt == startsAt &&
        other.endsAt == endsAt

    override fun hashCode(): Int = listOf(window, startDate, startsAt, endsAt).hashCode()

    override fun toString(): String = "ActiveWindow(${window.type})"
}

/** What is in force at [at] and when that next changes. Windows of different types may be active together. */
class ScheduleState(
    val at: Instant,
    /** Sorted BEDTIME, SCHOOL, CUSTOM, then by start time, then by id. */
    val active: List<ActiveWindow>,
    /** The next instant (strictly after [at]) at which a window starts or ends; null when there are no windows. */
    val nextBoundary: Instant?,
) {
    val isQuiet: Boolean get() = active.isNotEmpty()

    override fun equals(other: Any?): Boolean = other is ScheduleState &&
        other.at == at && other.active == active && other.nextBoundary == nextBoundary

    override fun hashCode(): Int = listOf(at, active, nextBoundary).hashCode()

    override fun toString(): String = "ScheduleState(${active.size} active)"
}

/**
 * Pure schedule evaluation. Windows are read as WALL-CLOCK times in [ZoneId]: each occurrence is `start..end` on its
 * start date, converted to instants with the zone's rules. So on a spring-forward day a start inside the gap moves
 * forward, on a fall-back day an ambiguous time takes the earlier offset, and an overnight window is one real
 * interval whose length follows the clock change. An occurrence whose end is not after its start (a window that
 * vanishes inside a DST gap) is ignored.
 */
object ScheduleEvaluator {
    /** Days before today an occurrence may still be running (overnight windows are at most a day long). */
    private const val LOOK_BEHIND_DAYS = 1L

    /** A weekly window always has an occurrence within a week, so a boundary is found within eight days. */
    private const val LOOK_AHEAD_DAYS = 8L

    /**
     * The zone the schedules are read in: the parent's `timezone` when it names a zone this phone knows, otherwise the
     * device's own zone (also for an unknown or malformed name: the parent's intent cannot be honoured, the phone's
     * own clock still can).
     */
    fun zoneFor(timezone: String?, deviceZone: ZoneId): ZoneId {
        if (timezone == null) return deviceZone
        return try {
            ZoneId.of(timezone)
        } catch (_: Exception) {
            deviceZone
        }
    }

    fun evaluate(windows: List<ScheduleWindow>, zone: ZoneId, at: Instant): ScheduleState {
        if (windows.isEmpty()) return ScheduleState(at, emptyList(), null)
        val today = at.atZone(zone).toLocalDate()
        val first = today.minusDays(LOOK_BEHIND_DAYS)
        val active = ArrayList<ActiveWindow>()
        var next: Instant? = null
        var date = first
        val last = today.plusDays(LOOK_AHEAD_DAYS)
        while (!date.isAfter(last)) {
            for (window in windows) {
                if (date.dayOfWeek.value !in window.days) continue
                val occurrence = occurrence(window, date, zone) ?: continue
                val (startsAt, endsAt) = occurrence
                if (startsAt <= at && at < endsAt) active += ActiveWindow(window, date, startsAt, endsAt)
                for (edge in listOf(startsAt, endsAt)) {
                    if (edge > at && (next == null || edge < next)) next = edge
                }
            }
            date = date.plusDays(1)
        }
        return ScheduleState(at, active.sortedWith(ORDER), next)
    }

    /** Start and end instants of [window] on the occurrence that starts on [date]; null when it has no length. */
    private fun occurrence(window: ScheduleWindow, date: LocalDate, zone: ZoneId): Pair<Instant, Instant>? {
        val start = at(date, window.startMinute, zone)
        val endDate = if (window.isOvernight) date.plusDays(1) else date
        val end = at(endDate, window.endMinute, zone)
        return if (end > start) start to end else null
    }

    private fun at(date: LocalDate, minuteOfDay: Int, zone: ZoneId): Instant =
        ZonedDateTime.of(LocalDateTime.of(date, LocalTime.of(minuteOfDay / 60, minuteOfDay % 60)), zone).toInstant()

    private val ORDER = compareBy<ActiveWindow>({ it.window.type.ordinal }, { it.startsAt }, { it.window.id })
}
