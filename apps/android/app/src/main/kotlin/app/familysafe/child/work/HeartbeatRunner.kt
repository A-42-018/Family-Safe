package app.familysafe.child.work

import app.familysafe.child.data.HeartbeatRepository
import app.familysafe.child.data.HeartbeatResult
import app.familysafe.child.data.SyncStatusStore
import app.familysafe.child.domain.HeartbeatPayloadSource

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class HeartbeatRunResult {
    /** Recorded. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (server refused the request); do not back off, wait for the next period. */
    Failed,

    /** Not enrolled or disconnected: cancel the periodic work. */
    Stopped,
}

/** One heartbeat: collect, send, remember the sync time, translate the outcome. */
class HeartbeatRunner(
    private val payloads: HeartbeatPayloadSource,
    private val repository: HeartbeatRepository,
    private val syncStatus: SyncStatusStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): HeartbeatRunResult {
        val payload = try {
            payloads.current()
        } catch (_: Exception) {
            return HeartbeatRunResult.Failed
        }
        return when (val result = repository.send(payload)) {
            is HeartbeatResult.Sent -> {
                syncStatus.recordSuccess(result.serverTimeEpochMillis ?: clock())
                HeartbeatRunResult.Sent
            }
            HeartbeatResult.NotEnrolled, HeartbeatResult.Disconnected -> {
                syncStatus.clear()
                HeartbeatRunResult.Stopped
            }
            is HeartbeatResult.RetryLater -> HeartbeatRunResult.Retry
            HeartbeatResult.Rejected -> HeartbeatRunResult.Failed
        }
    }
}
