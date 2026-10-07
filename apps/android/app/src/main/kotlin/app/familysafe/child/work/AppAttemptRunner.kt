package app.familysafe.child.work

import app.familysafe.child.data.AppAttemptRepository
import app.familysafe.child.data.AppAttemptResult
import app.familysafe.child.data.AppAttemptStore
import app.familysafe.child.domain.AppAttemptBatch

/** What the WorkManager worker should do next. Kept free of WorkManager types so it is JVM-testable. */
enum class AppAttemptRunResult {
    /** Everything usable was sent (or there was nothing to send). */
    Sent,

    /** Try again with WorkManager's backoff. */
    Retry,

    /** The server refused at least one batch; it was dropped. This run ends, later attempts will be queued again. */
    Failed,

    /** Not enrolled or disconnected: cancel the work. */
    Stopped,
}

/**
 * Uploads the outbox in batches of at most 20, oldest first. Attempts too old for the server's window are dropped
 * first. A sent batch leaves the outbox; a refused batch is dropped (repeating cannot help); a retryable failure
 * keeps everything for the next run. Repeats are harmless: the server ignores a second attempt for the same package
 * within five minutes.
 */
class AppAttemptRunner(
    private val repository: AppAttemptRepository,
    private val store: AppAttemptStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun run(): AppAttemptRunResult {
        var rejected = false
        repeat(MAX_BATCHES) {
            val now = clock()
            val usable = AppAttemptBatch.usable(store.snapshot().pending, now)
            store.replacePending(usable)
            val batch = AppAttemptBatch.next(usable, now)
            if (batch.isEmpty()) return if (rejected) AppAttemptRunResult.Failed else AppAttemptRunResult.Sent
            when (repository.send(batch)) {
                AppAttemptResult.Sent -> store.removePending(batch)
                AppAttemptResult.Rejected -> {
                    rejected = true
                    store.removePending(batch)
                }
                is AppAttemptResult.RetryLater -> return AppAttemptRunResult.Retry
                AppAttemptResult.NotEnrolled, AppAttemptResult.Disconnected -> {
                    store.clear()
                    return AppAttemptRunResult.Stopped
                }
            }
        }
        // More than MAX_BATCHES batches cannot exist (the outbox is capped), but never loop forever.
        val done = store.snapshot().pending.isEmpty() && !rejected
        return if (done) AppAttemptRunResult.Sent else AppAttemptRunResult.Retry
    }

    private companion object {
        const val MAX_BATCHES = 4
    }
}
