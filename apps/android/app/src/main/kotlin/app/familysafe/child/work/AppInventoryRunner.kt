package app.familysafe.child.work

import app.familysafe.child.data.AppInventoryReportStore
import app.familysafe.child.data.AppInventoryRepository
import app.familysafe.child.data.AppInventoryResult
import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.InstalledAppsSource

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class AppInventoryRunResult {
    /** Recorded. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (empty reading or the server refused it); wait for the next period. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/** One upload: read, sanitize + send, remember exactly what was shared, translate the outcome. */
class AppInventoryRunner(
    private val source: InstalledAppsSource,
    private val repository: AppInventoryRepository,
    private val reports: AppInventoryReportStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): AppInventoryRunResult {
        val apps = try {
            source.current()
        } catch (_: Exception) {
            return AppInventoryRunResult.Failed
        }
        return when (val result = repository.send(apps)) {
            is AppInventoryResult.Sent -> {
                reports.record(AppInventoryReport(result.shared, result.serverTimeEpochMillis ?: clock()))
                AppInventoryRunResult.Sent
            }
            AppInventoryResult.NotEnrolled, AppInventoryResult.Disconnected -> {
                reports.clear()
                AppInventoryRunResult.Stopped
            }
            is AppInventoryResult.RetryLater -> AppInventoryRunResult.Retry
            AppInventoryResult.Rejected -> AppInventoryRunResult.Failed
        }
    }
}
