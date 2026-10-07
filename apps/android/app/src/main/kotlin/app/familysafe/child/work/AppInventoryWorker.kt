package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Daily app-list upload (network required), also used for the one-off upload after the list changed. All logic
 * lives in [AppInventoryRunner]; this class only maps its result to WorkManager. For periodic work `failure()`
 * ends this run only. Not exported: WorkManager owns the component.
 */
class AppInventoryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.appInventoryRunner.run()) {
            AppInventoryRunResult.Sent -> Result.success()
            AppInventoryRunResult.Retry -> Result.retry()
            AppInventoryRunResult.Failed -> Result.failure()
            AppInventoryRunResult.Stopped -> {
                container.workScheduler.cancelAppInventory()
                Result.success()
            }
        }
    }
}
