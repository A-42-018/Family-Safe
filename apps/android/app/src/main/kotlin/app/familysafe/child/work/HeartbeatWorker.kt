package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Periodic heartbeat (every 15 minutes, network required). All logic lives in [HeartbeatRunner]; this class only
 * maps its result to WorkManager. For periodic work `failure()` ends this run only — the next period still runs.
 * Not exported and never started by an intent from outside: WorkManager owns the component.
 */
class HeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.heartbeatRunner.run()) {
            HeartbeatRunResult.Sent -> Result.success()
            HeartbeatRunResult.Retry -> Result.retry()
            HeartbeatRunResult.Failed -> Result.failure()
            HeartbeatRunResult.Stopped -> {
                container.workScheduler.cancelHeartbeat()
                Result.success()
            }
        }
    }
}
