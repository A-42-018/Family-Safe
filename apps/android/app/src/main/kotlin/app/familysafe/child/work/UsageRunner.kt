package app.familysafe.child.work

import app.familysafe.child.data.UsageReportStore
import app.familysafe.child.data.UsageRepository
import app.familysafe.child.data.UsageResult
import app.familysafe.child.domain.DayUsage
import app.familysafe.child.domain.LocalDay
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageDays
import app.familysafe.child.domain.UsageEventAggregator
import app.familysafe.child.domain.UsageEventsSource
import app.familysafe.child.domain.UsagePolicy
import app.familysafe.child.domain.UsageReport
import java.time.ZoneId

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class UsageRunResult {
    /** Recorded. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (the server refused it); wait for the next period. */
    Failed,

    /** Usage Access is off or unreadable: nothing was read, nothing was sent; the next period checks again. */
    NoAccess,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/**
 * One upload: check that the child has switched Usage Access on, read today's events (and yesterday's on the first
 * upload of a new local day), send, remember exactly what was shared, translate the outcome. Without access
 * nothing is read at all.
 */
class UsageRunner(
    private val access: UsageAccessProbe,
    private val source: UsageEventsSource,
    private val repository: UsageRepository,
    private val reports: UsageReportStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
    suspend fun run(): UsageRunResult {
        if (access.state() != UsageAccess.GRANTED) return UsageRunResult.NoAccess
        val now = clock()
        val zoneId = zone()
        val today = UsageDays.dayOf(now, zoneId)
        val days = if (UsagePolicy.includesYesterday(reports.report.value, today.day)) {
            listOf(UsageDays.previous(today, zoneId), today)
        } else {
            listOf(today)
        }
        for (day in days) {
            val usage = try {
                read(day, now)
            } catch (_: Exception) {
                return UsageRunResult.NoAccess
            }
            when (val result = repository.send(usage)) {
                is UsageResult.Sent -> {
                    // Only the most recent day is shown to the child; yesterday's repeat is silent.
                    if (day === days.last()) {
                        reports.record(UsageReport(result.shared, result.serverTimeEpochMillis ?: now))
                    }
                }
                UsageResult.NotEnrolled, UsageResult.Disconnected -> {
                    reports.clear()
                    return UsageRunResult.Stopped
                }
                is UsageResult.RetryLater -> return UsageRunResult.Retry
                UsageResult.Rejected -> return UsageRunResult.Failed
            }
        }
        return UsageRunResult.Sent
    }

    /** Events of one local day; today's window ends now so open apps are counted up to this moment only. */
    private fun read(day: LocalDay, now: Long): DayUsage {
        val end = minOf(day.endMillis, now)
        val events = source.events(day.startMillis, end)
        return UsageEventAggregator.aggregate(events, day.day, day.startMillis, end)
    }
}
