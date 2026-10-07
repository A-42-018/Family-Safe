package app.familysafe.child.domain

import java.time.LocalDate

/** Timings of the "daily limit reached" report. The values are checked against the contract by a JVM drift test. */
object LimitReportLimits {
    /** A report older than this is dropped: the server accepts a time at most 24 h back (minus a safety margin). */
    const val MAX_AGE_MILLIS = 23L * 60L * 60L * 1_000L
}

/** The one thing the parent is told: which local day the limit was reached and when. No minutes, no apps. */
class PendingLimitReport(val day: String, val occurredAtEpochMillis: Long) {
    override fun equals(other: Any?): Boolean =
        other is PendingLimitReport && other.day == day && other.occurredAtEpochMillis == occurredAtEpochMillis

    override fun hashCode(): Int = 31 * day.hashCode() + occurredAtEpochMillis.hashCode()

    override fun toString(): String = "PendingLimitReport"
}

/** [lastReportedDay]: the last local day that was reported or refused (never queued twice). [pending]: waiting for an upload. */
class LimitReportState(val lastReportedDay: String? = null, val pending: PendingLimitReport? = null) {
    override fun equals(other: Any?): Boolean =
        other is LimitReportState && other.lastReportedDay == lastReportedDay && other.pending == pending

    override fun hashCode(): Int = 31 * (lastReportedDay?.hashCode() ?: 0) + (pending?.hashCode() ?: 0)

    override fun toString(): String = "LimitReportState"
}

/** Pure rules: when a reached limit becomes a report, and what is still worth sending. */
object LimitReportPlanner {
    /**
     * A new pending report when today's check says LIMIT and that day was neither reported nor queued yet; otherwise
     * [state] unchanged. A queued report for an older day is replaced (only the newest day matters).
     */
    fun queue(state: LimitReportState, status: LimitStatus, nowEpochMillis: Long): LimitReportState {
        val active = status as? LimitStatus.Active ?: return state
        if (active.evaluation.level != LimitLevel.LIMIT) return state
        val day = active.evaluation.day
        if (!isDay(day) || day == state.lastReportedDay || day == state.pending?.day) return state
        val at = active.checkedAtEpochMillis.coerceIn(nowEpochMillis - LimitReportLimits.MAX_AGE_MILLIS, nowEpochMillis)
        return LimitReportState(state.lastReportedDay, PendingLimitReport(day, at))
    }

    /** The pending report when it is still inside the server's window, else null. */
    fun usable(state: LimitReportState, nowEpochMillis: Long): PendingLimitReport? {
        val p = state.pending ?: return null
        val age = nowEpochMillis - p.occurredAtEpochMillis
        return p.takeIf { age in 0..LimitReportLimits.MAX_AGE_MILLIS }
    }

    /** The day was sent (or refused for good): never queue it again. */
    fun done(state: LimitReportState, day: String): LimitReportState =
        LimitReportState(day, state.pending?.takeIf { it.day != day })

    private fun isDay(value: String): Boolean = try {
        LocalDate.parse(value).toString() == value
    } catch (_: Exception) {
        false
    }
}

/** Single-string form for the sealed store: `v1;lastReportedDay;pendingDay;pendingMillis` (empty = none). */
object LimitReportStateCodec {
    private const val TAG = "v1"
    private const val FIELDS = 4

    fun encode(state: LimitReportState): String = listOf(
        TAG,
        state.lastReportedDay.orEmpty(),
        state.pending?.day.orEmpty(),
        state.pending?.occurredAtEpochMillis?.toString().orEmpty(),
    ).joinToString(";")

    /** Null for anything [encode] would not write. */
    fun decode(text: String?): LimitReportState? {
        val parts = text?.split(";") ?: return null
        if (parts.size != FIELDS || parts[0] != TAG) return null
        val last = parts[1].ifEmpty { null }
        if (last != null && !valid(last)) return null
        val pendingDay = parts[2].ifEmpty { null }
        val pendingMillis = parts[3].ifEmpty { null }?.let { it.toLongOrNull()?.takeIf { v -> v > 0 } ?: return null }
        if ((pendingDay == null) != (pendingMillis == null)) return null
        if (pendingDay != null && !valid(pendingDay)) return null
        val pending = if (pendingDay != null && pendingMillis != null) {
            PendingLimitReport(
                pendingDay,
                pendingMillis,
            )
        } else {
            null
        }
        return LimitReportState(last, pending)
    }

    private fun valid(day: String): Boolean = try {
        LocalDate.parse(day).toString() == day
    } catch (_: Exception) {
        false
    }
}
