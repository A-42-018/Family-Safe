package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * One-off upload of the "daily limit reached" report (network required), queued when the on-device check first sees
 * the limit reached for a day. All logic lives in [LimitReportRunner]; this class only maps its result to WorkManager.
 * Not exported: WorkManager owns the component.
 */
class LimitReportWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.limitReportRunner.run()) {
            LimitReportRunResult.Sent -> Result.success()
            LimitReportRunResult.Retry -> Result.retry()
            LimitReportRunResult.Failed -> Result.failure()
            LimitReportRunResult.Stopped -> {
                container.workScheduler.cancelLimitReport()
                Result.success()
            }
        }
    }
}
