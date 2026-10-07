package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * One-off upload of blocked-app attempts (network required), queued when the on-device check counted a new attempt
 * or when the app is opened with attempts still waiting. All logic lives in [AppAttemptRunner]; this class only
 * maps its result to WorkManager. Not exported: WorkManager owns the component.
 */
class AppAttemptWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.appAttemptRunner.run()) {
            AppAttemptRunResult.Sent -> Result.success()
            AppAttemptRunResult.Retry -> Result.retry()
            AppAttemptRunResult.Failed -> Result.failure()
            AppAttemptRunResult.Stopped -> {
                container.workScheduler.cancelAppAttempts()
                Result.success()
            }
        }
    }
}
