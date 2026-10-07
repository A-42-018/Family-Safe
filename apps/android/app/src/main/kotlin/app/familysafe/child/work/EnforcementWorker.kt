package app.familysafe.child.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.familysafe.child.FamilySafeApp

/**
 * Every 15 minutes while the phone is in managed mode: re-checks limits and schedules and pauses or resumes apps, so
 * a limit reached while FamilySafe is closed, or a new day, takes effect without opening the app. No network. Never
 * scheduled on a normal phone. Not exported.
 */
class EnforcementWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as FamilySafeApp).container.runBackgroundChecks()
        return Result.success()
    }
}
