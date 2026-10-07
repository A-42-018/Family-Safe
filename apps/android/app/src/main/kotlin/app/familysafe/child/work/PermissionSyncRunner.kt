package app.familysafe.child.work

import app.familysafe.child.data.PermissionStateReader
import app.familysafe.child.data.PermissionStateStore
import app.familysafe.child.data.PermissionSyncRepository
import app.familysafe.child.data.PermissionSyncResult
import app.familysafe.child.domain.PermissionSyncReport

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class PermissionSyncRunResult {
    /** Recorded. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (nothing readable or the server refused it); wait for the next period. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/** One sync: read the OS state, show it, send it, remember exactly what was shared, translate the outcome. */
class PermissionSyncRunner(
    private val reader: PermissionStateReader,
    private val repository: PermissionSyncRepository,
    private val states: PermissionStateStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): PermissionSyncRunResult {
        val observation = try {
            reader.read()
        } catch (_: Exception) {
            return PermissionSyncRunResult.Failed
        }
        states.observe(observation)
        return when (val result = repository.send(observation)) {
            is PermissionSyncResult.Sent -> {
                states.recordAcknowledged(PermissionSyncReport(result.shared, result.serverTimeEpochMillis ?: clock()))
                PermissionSyncRunResult.Sent
            }
            PermissionSyncResult.NotEnrolled, PermissionSyncResult.Disconnected -> {
                states.clearReport()
                PermissionSyncRunResult.Stopped
            }
            is PermissionSyncResult.RetryLater -> PermissionSyncRunResult.Retry
            PermissionSyncResult.Rejected -> PermissionSyncRunResult.Failed
        }
    }
}
