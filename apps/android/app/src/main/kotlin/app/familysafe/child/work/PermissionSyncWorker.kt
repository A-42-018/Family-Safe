package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Permission-state sync every 6 hours (network required), also used for the one-off sync after the app resumes
 * with a changed or stale state. All logic lives in [PermissionSyncRunner]; this class only maps its result to
 * WorkManager. For periodic work `failure()` ends this run only. Not exported: WorkManager owns the component.
 */
class PermissionSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.permissionSyncRunner.run()) {
            PermissionSyncRunResult.Sent -> Result.success()
            PermissionSyncRunResult.Retry -> Result.retry()
            PermissionSyncRunResult.Failed -> Result.failure()
            PermissionSyncRunResult.Stopped -> {
                container.workScheduler.cancelPermissionSync()
                Result.success()
            }
        }
    }
}
