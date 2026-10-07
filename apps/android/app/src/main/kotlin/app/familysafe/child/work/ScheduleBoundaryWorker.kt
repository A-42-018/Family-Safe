package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * One-off job that runs shortly after a schedule starts or ends: it re-checks the schedules (memory only) and arms
 * the next one. No network, no exact alarm, no notification; WorkManager may run it late. Not exported.
 */
class ScheduleBoundaryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as FamilySafeApp).container.checkSchedules()
        return Result.success()
    }
}
