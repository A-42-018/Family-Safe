package app.familysafe.child.work

import app.familysafe.child.data.LimitReportRepository
import app.familysafe.child.data.LimitReportResult
import app.familysafe.child.data.LimitReportStore
import app.familysafe.child.domain.LimitReportPlanner
import app.familysafe.child.domain.LimitReportState

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class LimitReportRunResult {
    /** Sent, or there was nothing (left) to send. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** The server refused the report; it was dropped. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/**
 * Uploads the pending "daily limit reached" report (day + time only). A report too old for the server's window is
 * dropped first. A sent report and a refused one both leave the outbox and mark the day as done; a retryable failure
 * keeps it for the next run.
 */
class LimitReportRunner(
    private val repository: LimitReportRepository,
    private val store: LimitReportStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): LimitReportRunResult {
        val now = clock()
        val pending = LimitReportPlanner.usable(store.snapshot(), now)
        if (pending == null) {
            store.update { it.pending?.let { _ -> LimitReportState(it.lastReportedDay, null) } ?: it }
            return LimitReportRunResult.Sent
        }
        return when (repository.send(pending)) {
            LimitReportResult.Sent -> {
                store.update { LimitReportPlanner.done(it, pending.day) }
                LimitReportRunResult.Sent
            }
            LimitReportResult.Rejected -> {
                store.update { LimitReportPlanner.done(it, pending.day) }
                LimitReportRunResult.Failed
            }
            is LimitReportResult.RetryLater -> LimitReportRunResult.Retry
            LimitReportResult.NotEnrolled, LimitReportResult.Disconnected -> {
                store.clear()
                LimitReportRunResult.Stopped
            }
        }
    }
}
