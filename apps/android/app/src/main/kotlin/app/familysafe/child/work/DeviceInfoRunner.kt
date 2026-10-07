package app.familysafe.child.work

import app.familysafe.child.data.DeviceInfoReportStore
import app.familysafe.child.data.DeviceInfoRepository
import app.familysafe.child.data.DeviceInfoResult
import app.familysafe.child.domain.DeviceDetailsSource
import app.familysafe.child.domain.DeviceInfoReport

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class DeviceInfoRunResult {
    /** Recorded. */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (nothing valid to send or the server refused it); wait for the next period. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/** One upload: collect, send, remember exactly what was shared, translate the outcome. */
class DeviceInfoRunner(
    private val source: DeviceDetailsSource,
    private val repository: DeviceInfoRepository,
    private val reports: DeviceInfoReportStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): DeviceInfoRunResult {
        val details = try {
            source.current()
        } catch (_: Exception) {
            return DeviceInfoRunResult.Failed
        }
        return when (val result = repository.send(details)) {
            is DeviceInfoResult.Sent -> {
                reports.record(DeviceInfoReport(result.shared, result.serverTimeEpochMillis ?: clock()))
                DeviceInfoRunResult.Sent
            }
            DeviceInfoResult.NotEnrolled, DeviceInfoResult.Disconnected -> {
                reports.clear()
                DeviceInfoRunResult.Stopped
            }
            is DeviceInfoResult.RetryLater -> DeviceInfoRunResult.Retry
            DeviceInfoResult.Rejected -> DeviceInfoRunResult.Failed
        }
    }
}
