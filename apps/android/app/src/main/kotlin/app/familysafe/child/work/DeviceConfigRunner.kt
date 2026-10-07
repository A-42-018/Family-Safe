package app.familysafe.child.work

import app.familysafe.child.data.DeviceConfigRepository
import app.familysafe.child.data.DeviceConfigResult
import app.familysafe.child.data.DeviceConfigStore

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class DeviceConfigRunResult {
    /** A new config was cached. */
    Updated,

    /** The server confirmed the cached version (304). */
    Unchanged,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** This run cannot succeed (the server refused it or sent something unusable); wait for the next period. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/**
 * One pull: ask with the cached version, cache what comes back, translate the outcome. An EXPIRED cache is still
 * sent as `If-None-Match` — a 304 then simply re-confirms that version, which is exactly what the server says.
 */
class DeviceConfigRunner(
    private val repository: DeviceConfigRepository,
    private val store: DeviceConfigStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): DeviceConfigRunResult =
        when (val result = repository.fetch(store.cached.value?.config)) {
            is DeviceConfigResult.Fetched -> {
                store.record(result.parsed.config, clock())
                DeviceConfigRunResult.Updated
            }
            // The cache changed or vanished between the request and the answer: pull again in full.
            is DeviceConfigResult.NotModified -> if (store.confirm(result.version, clock())) {
                DeviceConfigRunResult.Unchanged
            } else {
                DeviceConfigRunResult.Retry
            }
            DeviceConfigResult.NotEnrolled, DeviceConfigResult.Disconnected -> {
                store.clear()
                DeviceConfigRunResult.Stopped
            }
            is DeviceConfigResult.RetryLater -> DeviceConfigRunResult.Retry
            DeviceConfigResult.Rejected -> DeviceConfigRunResult.Failed
        }
}
