package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Daily device-info upload (network required), also used for the one-off upload after an OS or patch update. All
 * logic lives in [DeviceInfoRunner]; this class only maps its result to WorkManager. For periodic work `failure()`
 * ends this run only. Not exported: WorkManager owns the component.
 */
class DeviceInfoWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.deviceInfoRunner.run()) {
            DeviceInfoRunResult.Sent -> Result.success()
            DeviceInfoRunResult.Retry -> Result.retry()
            DeviceInfoRunResult.Failed -> Result.failure()
            DeviceInfoRunResult.Stopped -> {
                container.workScheduler.cancelDeviceInfo()
                Result.success()
            }
        }
    }
}
