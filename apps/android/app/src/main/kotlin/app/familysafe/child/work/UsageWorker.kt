package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Six-hourly usage upload (network required), also used for the one-off upload after the child switched Usage
 * Access on. All logic lives in [UsageRunner]; this class only maps its result to WorkManager. For periodic work
 * `failure()` ends this run only. Not exported: WorkManager owns the component.
 */
class UsageWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.usageRunner.run()) {
            UsageRunResult.Sent, UsageRunResult.NoAccess -> Result.success()
            UsageRunResult.Retry -> Result.retry()
            UsageRunResult.Failed -> Result.failure()
            UsageRunResult.Stopped -> {
                container.workScheduler.cancelUsage()
                Result.success()
            }
        }
    }
}
