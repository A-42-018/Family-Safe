package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Six-hourly rules pull (network required), also used for the one-off pull when the app is opened and the cache is
 * old. All logic lives in [DeviceConfigRunner]; this class only maps its result to WorkManager. For periodic work
 * `failure()` ends this run only. Not exported: WorkManager owns the component.
 */
class DeviceConfigWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FamilySafeApp).container
        return when (container.deviceConfigRunner.run()) {
            DeviceConfigRunResult.Updated, DeviceConfigRunResult.Unchanged -> Result.success()
            DeviceConfigRunResult.Retry -> Result.retry()
            DeviceConfigRunResult.Failed -> Result.failure()
            DeviceConfigRunResult.Stopped -> {
                container.workScheduler.cancelDeviceConfig()
                Result.success()
            }
        }
    }
}
