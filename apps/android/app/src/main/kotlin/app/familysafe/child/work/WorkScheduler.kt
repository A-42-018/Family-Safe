package app.familysafe.child.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.domain.DeviceDetailsLimits
import app.familysafe.child.domain.HeartbeatLimits
import app.familysafe.child.domain.PermissionSyncLimits
import app.familysafe.child.domain.ScreenTimeLimits
import app.familysafe.child.domain.UsageLimits
import java.util.concurrent.TimeUnit

/**
 * Owns the WorkManager handle and the jobs this app has: the heartbeat, the device-info upload, the
 * permission-state sync, the app-list upload, the usage upload, the rules pull and the blocked-app attempt upload.
 * The handle is created lazily so app start-up does not initialise WorkManager needlessly.
 */
class WorkScheduler(private val context: Context) {
    val workManager: WorkManager by lazy { WorkManager.getInstance(context.applicationContext) }

    /** Idempotent: KEEP leaves an already scheduled job (and its timing) alone. */
    fun ensureHeartbeat() {
        val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(HeartbeatLimits.INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(HEARTBEAT_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancelHeartbeat() {
        workManager.cancelUniqueWork(HEARTBEAT_WORK)
    }

    /** Daily upload; like the heartbeat it first runs as soon as it is enqueued. Idempotent (KEEP). */
    fun ensureDeviceInfo() {
        val request = PeriodicWorkRequestBuilder<DeviceInfoWorker>(DeviceDetailsLimits.INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(DEVICE_INFO_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One extra upload right away (after an OS or patch update). KEEP: a pending one is not duplicated. */
    fun uploadDeviceInfoNow() {
        val request = OneTimeWorkRequestBuilder<DeviceInfoWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(DEVICE_INFO_NOW_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelDeviceInfo() {
        workManager.cancelUniqueWork(DEVICE_INFO_WORK)
        workManager.cancelUniqueWork(DEVICE_INFO_NOW_WORK)
    }

    /** Every 6 hours; like the others it first runs as soon as it is enqueued. Idempotent (KEEP). */
    fun ensurePermissionSync() {
        val request =
            PeriodicWorkRequestBuilder<PermissionSyncWorker>(PermissionSyncLimits.INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
                .build()
        workManager.enqueueUniquePeriodicWork(PERMISSION_SYNC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One extra sync right away (app resumed with a changed or stale state). KEEP: a pending one is not duplicated. */
    fun syncPermissionsNow() {
        val request = OneTimeWorkRequestBuilder<PermissionSyncWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(PERMISSION_SYNC_NOW_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelPermissionSync() {
        workManager.cancelUniqueWork(PERMISSION_SYNC_WORK)
        workManager.cancelUniqueWork(PERMISSION_SYNC_NOW_WORK)
    }

    /** Daily app-list upload; like the others it first runs as soon as it is enqueued. Idempotent (KEEP). */
    fun ensureAppInventory() {
        val request =
            PeriodicWorkRequestBuilder<AppInventoryWorker>(AppInventoryLimits.INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
                .build()
        workManager.enqueueUniquePeriodicWork(APP_INVENTORY_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One extra upload right away (the app list changed). KEEP: a pending one is not duplicated. */
    fun uploadAppInventoryNow() {
        val request = OneTimeWorkRequestBuilder<AppInventoryWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(APP_INVENTORY_NOW_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelAppInventory() {
        workManager.cancelUniqueWork(APP_INVENTORY_WORK)
        workManager.cancelUniqueWork(APP_INVENTORY_NOW_WORK)
    }

    /** Every 6 hours; like the others it first runs as soon as it is enqueued. Idempotent (KEEP). */
    fun ensureUsage() {
        val request = PeriodicWorkRequestBuilder<UsageWorker>(UsageLimits.INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(USAGE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One extra upload right away (Usage Access was just switched on, or the last one is old). KEEP: no duplicate. */
    fun uploadUsageNow() {
        val request = OneTimeWorkRequestBuilder<UsageWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(USAGE_NOW_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelUsage() {
        workManager.cancelUniqueWork(USAGE_WORK)
        workManager.cancelUniqueWork(USAGE_NOW_WORK)
    }

    /** Every 6 hours; like the others it first runs as soon as it is enqueued. Idempotent (KEEP). */
    fun ensureDeviceConfig() {
        val request = PeriodicWorkRequestBuilder<DeviceConfigWorker>(ScreenTimeLimits.INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(DEVICE_CONFIG_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One extra pull right away (the app was opened and the cached rules are old). KEEP: no duplicate. */
    fun pullDeviceConfigNow() {
        val request = OneTimeWorkRequestBuilder<DeviceConfigWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(DEVICE_CONFIG_NOW_WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelDeviceConfig() {
        workManager.cancelUniqueWork(DEVICE_CONFIG_WORK)
        workManager.cancelUniqueWork(DEVICE_CONFIG_NOW_WORK)
    }

    /**
     * Uploads waiting blocked-app attempts. APPEND_OR_REPLACE: an attempt counted while an upload is running still
     * gets its own run afterwards, and a failed earlier run does not block the new one.
     */
    fun uploadAppAttemptsNow() {
        val request = OneTimeWorkRequestBuilder<AppAttemptWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(APP_ATTEMPTS_NOW_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Uploads the pending "daily limit reached" report. APPEND_OR_REPLACE: a report queued during a run still gets its own. */
    fun uploadLimitReportNow() {
        val request = OneTimeWorkRequestBuilder<LimitReportWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_MINUTES, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniqueWork(LIMIT_REPORT_NOW_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun cancelLimitReport() {
        workManager.cancelUniqueWork(LIMIT_REPORT_NOW_WORK)
    }

    fun cancelAppAttempts() {
        workManager.cancelUniqueWork(APP_ATTEMPTS_NOW_WORK)
    }

    /**
     * Re-checks the schedules shortly after the next window starts or ends. A single one-off job (REPLACE: the newest
     * boundary wins), no network needed, no exact alarm: it may run late, and the foreground tick and the next
     * resume check as well.
     */
    fun scheduleBoundary(delayMillis: Long) {
        val request = OneTimeWorkRequestBuilder<ScheduleBoundaryWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .build()
        workManager.enqueueUniqueWork(SCHEDULE_BOUNDARY_WORK, ExistingWorkPolicy.REPLACE, request)
    }

    /**
     * Managed mode only: every 15 minutes (WorkManager's minimum) re-checks and applies the pause list. No network.
     * Idempotent (KEEP). Never scheduled on a normal phone.
     */
    fun ensureEnforcement() {
        val request = PeriodicWorkRequestBuilder<EnforcementWorker>(ENFORCEMENT_MINUTES, TimeUnit.MINUTES).build()
        workManager.enqueueUniquePeriodicWork(ENFORCEMENT_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancelEnforcement() {
        workManager.cancelUniqueWork(ENFORCEMENT_WORK)
    }

    fun cancelScheduleBoundary() {
        workManager.cancelUniqueWork(SCHEDULE_BOUNDARY_WORK)
    }

    private fun networkConstraints(): Constraints =
        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    companion object {
        const val HEARTBEAT_WORK = "heartbeat"
        const val DEVICE_INFO_WORK = "device-info"
        const val DEVICE_INFO_NOW_WORK = "device-info-now"
        const val PERMISSION_SYNC_WORK = "permission-sync"
        const val PERMISSION_SYNC_NOW_WORK = "permission-sync-now"
        const val APP_INVENTORY_WORK = "app-inventory"
        const val APP_INVENTORY_NOW_WORK = "app-inventory-now"
        const val USAGE_WORK = "usage"
        const val USAGE_NOW_WORK = "usage-now"
        const val DEVICE_CONFIG_WORK = "device-config"
        const val DEVICE_CONFIG_NOW_WORK = "device-config-now"
        const val APP_ATTEMPTS_NOW_WORK = "app-attempts-now"
        const val LIMIT_REPORT_NOW_WORK = "limit-report-now"
        const val SCHEDULE_BOUNDARY_WORK = "schedule-boundary"
        const val ENFORCEMENT_WORK = "enforcement"
        private const val ENFORCEMENT_MINUTES = 15L
        private const val BACKOFF_MINUTES = 1L
    }
}
