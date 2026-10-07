package app.familysafe.child.di

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.familysafe.child.BuildConfig
import app.familysafe.child.config.ApiBaseUrl
import app.familysafe.child.config.AppConfig
import app.familysafe.child.data.AesGcmSealer
import app.familysafe.child.data.AndroidInstalledAppsSource
import app.familysafe.child.data.AndroidDeviceDetailsSource
import app.familysafe.child.data.AndroidDeviceInfoProvider
import app.familysafe.child.data.AndroidHeartbeatPayloadSource
import app.familysafe.child.data.AndroidPermissionProbe
import app.familysafe.child.data.AndroidUsageAccessProbe
import app.familysafe.child.data.AndroidUsageStatsSource
import app.familysafe.child.data.AppAttemptRepository
import app.familysafe.child.data.AppAttemptStore
import app.familysafe.child.data.AppInventoryReportStore
import app.familysafe.child.data.AppInventoryRepository
import app.familysafe.child.data.AppRuleStatusStore
import app.familysafe.child.data.AuthenticatedExecutor
import app.familysafe.child.data.CredentialStore
import app.familysafe.child.data.DeviceConfigRepository
import app.familysafe.child.data.DeviceConfigStore
import app.familysafe.child.data.DeviceInfoReportStore
import app.familysafe.child.data.DeviceInfoRepository
import app.familysafe.child.data.EnrollmentApi
import app.familysafe.child.data.EnrollmentRepository
import app.familysafe.child.data.HeartbeatRepository
import app.familysafe.child.data.KeystoreKeyProvider
import app.familysafe.child.data.KtorDeviceHttp
import app.familysafe.child.data.KtorEnrollmentApi
import app.familysafe.child.data.KtorRefreshApi
import app.familysafe.child.data.LimitStatusStore
import app.familysafe.child.data.PermissionHistoryStore
import app.familysafe.child.data.PermissionStateReader
import app.familysafe.child.data.PermissionStateStore
import app.familysafe.child.data.PermissionSyncRepository
import app.familysafe.child.data.SealedSecureStore
import app.familysafe.child.data.SecureStore
import app.familysafe.child.data.SharedPrefsBlobStorage
import app.familysafe.child.data.SyncStatusStore
import app.familysafe.child.data.TokenProvider
import app.familysafe.child.data.UsageAccessStore
import app.familysafe.child.data.UsageReportStore
import app.familysafe.child.data.UsageRepository
import app.familysafe.child.domain.AppInventoryPolicy
import app.familysafe.child.domain.AppInventorySanitizer
import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.domain.DeviceDetailsSource
import app.familysafe.child.domain.DeviceInfoPolicy
import app.familysafe.child.domain.HeartbeatPolicy
import app.familysafe.child.domain.InstalledAppsSource
import app.familysafe.child.domain.PermissionSyncPolicy
import app.familysafe.child.domain.ScreenTimeConfigPolicy
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsagePolicy
import app.familysafe.child.ui.enrollment.EnrollmentViewModel
import app.familysafe.child.work.AppAttemptRunner
import app.familysafe.child.work.AppInventoryRunner
import app.familysafe.child.work.AppRuleCheckRunner
import app.familysafe.child.work.DeviceConfigRunner
import app.familysafe.child.work.DeviceInfoRunner
import app.familysafe.child.work.HeartbeatRunner
import app.familysafe.child.work.LimitCheckRunner
import app.familysafe.child.work.PermissionSyncRunner
import app.familysafe.child.work.UsageRunner
import app.familysafe.child.work.WorkScheduler
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** Manual dependency container (decision: no Hilt/kapt). Everything is lazy so the launcher starts fast. */
class AppContainer(private val context: Context) {
    val config: AppConfig by lazy {
        val url = ApiBaseUrl.parse(BuildConfig.API_BASE_URL, allowLoopbackHttp = BuildConfig.DEBUG).getOrElse {
            error("Invalid familysafe.apiBaseUrl for this build type") // message never includes the value
        }
        AppConfig(url, BuildConfig.VERSION_NAME, BuildConfig.DEBUG)
    }

    val secureStore: SecureStore by lazy {
        SealedSecureStore(AesGcmSealer(KeystoreKeyProvider.getOrCreate()), SharedPrefsBlobStorage(context))
    }

    val workScheduler: WorkScheduler by lazy { WorkScheduler(context) }

    /** Application-lifetime scope for work that must finish even if the screen goes away (the redeem call). */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val enrollmentApi: EnrollmentApi by lazy {
        KtorEnrollmentApi(KtorEnrollmentApi.defaultClient(), config.apiBaseUrl)
    }

    private val credentialStore: CredentialStore by lazy { CredentialStore(secureStore) }

    val enrollmentRepository: EnrollmentRepository by lazy {
        EnrollmentRepository(enrollmentApi, credentialStore)
    }

    /** Access token (memory only) + refresh rotation. One instance: it owns the single-flight lock. */
    val tokenProvider: TokenProvider by lazy {
        TokenProvider(KtorRefreshApi(KtorEnrollmentApi.defaultClient(), config.apiBaseUrl), credentialStore)
    }

    /** The only way device endpoints (Phase 12+) are called: bearer token, one 401 -> refresh -> retry. */
    val deviceHttp: KtorDeviceHttp by lazy {
        KtorDeviceHttp(KtorEnrollmentApi.defaultClient(), config.apiBaseUrl, AuthenticatedExecutor(tokenProvider))
    }

    /** "Last sync" shown on the Sync status screen; written only by [heartbeatRunner]. */
    val syncStatusStore: SyncStatusStore by lazy { SyncStatusStore(secureStore) }

    val heartbeatRunner: HeartbeatRunner by lazy {
        HeartbeatRunner(
            payloads = AndroidHeartbeatPayloadSource(context, config.versionName),
            repository = HeartbeatRepository(deviceHttp),
            syncStatus = syncStatusStore,
        )
    }

    /** What the last acknowledged device-info upload contained; written only by [deviceInfoRunner]. */
    val deviceInfoReportStore: DeviceInfoReportStore by lazy { DeviceInfoReportStore(secureStore) }

    private val deviceDetailsSource: DeviceDetailsSource by lazy { AndroidDeviceDetailsSource() }

    val deviceInfoRunner: DeviceInfoRunner by lazy {
        DeviceInfoRunner(
            source = deviceDetailsSource,
            repository = DeviceInfoRepository(deviceHttp),
            reports = deviceInfoReportStore,
        )
    }

    /** Latest OS reading + what the server last acknowledged; shown on the Permissions screen. */
    val permissionStateStore: PermissionStateStore by lazy { PermissionStateStore(secureStore) }

    private val permissionStateReader: PermissionStateReader by lazy {
        PermissionStateReader(AndroidPermissionProbe(context), PermissionHistoryStore(secureStore))
    }

    val permissionSyncRunner: PermissionSyncRunner by lazy {
        PermissionSyncRunner(
            reader = permissionStateReader,
            repository = PermissionSyncRepository(deviceHttp),
            states = permissionStateStore,
        )
    }

    /** What the last acknowledged app-list upload contained; written only by [appInventoryRunner]. */
    val appInventoryReportStore: AppInventoryReportStore by lazy { AppInventoryReportStore(secureStore) }

    private val installedAppsSource: InstalledAppsSource by lazy { AndroidInstalledAppsSource(context) }

    val appInventoryRunner: AppInventoryRunner by lazy {
        AppInventoryRunner(
            source = installedAppsSource,
            repository = AppInventoryRepository(deviceHttp),
            reports = appInventoryReportStore,
        )
    }

    /** Latest Usage Access reading (memory only); the child switches it on in Android settings, never the app. */
    val usageAccessStore: UsageAccessStore by lazy { UsageAccessStore(AndroidUsageAccessProbe(context)) }

    /** What the last acknowledged usage upload contained; written only by [usageRunner]. */
    val usageReportStore: UsageReportStore by lazy { UsageReportStore(secureStore) }

    val usageRunner: UsageRunner by lazy {
        UsageRunner(
            access = AndroidUsageAccessProbe(context),
            source = AndroidUsageStatsSource(context),
            repository = UsageRepository(deviceHttp),
            reports = usageReportStore,
        )
    }

    /** The parent's rules as the server last sent them (sealed cache); written only by [deviceConfigRunner]. */
    val deviceConfigStore: DeviceConfigStore by lazy { DeviceConfigStore(secureStore) }

    val deviceConfigRunner: DeviceConfigRunner by lazy {
        DeviceConfigRunner(repository = DeviceConfigRepository(deviceHttp), store = deviceConfigStore)
    }

    /** Today's screen time against the parent's limit; memory only, written only by [limitCheckRunner]. */
    val limitStatusStore: LimitStatusStore by lazy { LimitStatusStore() }

    /** On-device limit check: local usage numbers against the cached rules. Sends nothing, stores nothing. */
    val limitCheckRunner: LimitCheckRunner by lazy {
        LimitCheckRunner(
            rules = { deviceConfigStore.cached.value },
            access = AndroidUsageAccessProbe(context),
            source = AndroidUsageStatsSource(context),
            status = limitStatusStore,
        )
    }

    /** App-rule check result; memory only, written only by [appRuleCheckRunner]. */
    val appRuleStatusStore: AppRuleStatusStore by lazy { AppRuleStatusStore() }

    /** Detection bookkeeping + the outbox of blocked-app attempts (sealed store); written by the check and upload. */
    val appAttemptStore: AppAttemptStore by lazy { AppAttemptStore(secureStore) }

    /**
     * On-device app-rule check: local usage numbers against the cached per-app rules, and blocked apps that were
     * opened since the last check become attempts in the outbox. Sends nothing itself; a new attempt queues the
     * upload (only while enrolled and not disconnected).
     */
    val appRuleCheckRunner: AppRuleCheckRunner by lazy {
        AppRuleCheckRunner(
            rules = { deviceConfigStore.cached.value },
            access = AndroidUsageAccessProbe(context),
            source = AndroidUsageStatsSource(context),
            status = appRuleStatusStore,
            attempts = appAttemptStore,
            onNewAttempts = { queueAppAttemptsNow() },
        )
    }

    val appAttemptRunner: AppAttemptRunner by lazy {
        AppAttemptRunner(repository = AppAttemptRepository(deviceHttp), store = appAttemptStore)
    }

    /** Wall-clock time of the last "did the app list change?" reading; limits how often opening the app re-reads. */
    @Volatile
    private var lastAppInventoryCheckMillis: Long? = null

    val appState: AppStateHolder by lazy {
        AppStateHolder(
            enrollmentRepository,
            tokenProvider.authState,
            appScope,
            syncStatusStore.status,
            deviceInfoReportStore.report,
            permissionStateStore.snapshot,
            appInventoryReportStore.report,
            usageReportStore.report,
            usageAccessStore.state,
            deviceConfigStore.cached,
            limitStatusStore.status,
            appRuleStatusStore.status,
        )
    }

    /**
     * Keeps the periodic jobs (heartbeat, daily device info, 6-hourly permission sync, daily app list, 6-hourly
     * usage, 6-hourly rules pull) in step with the app state: scheduled while enrolled and not disconnected,
     * cancelled otherwise. After an OS or patch update one extra device-info upload is queued, and after a changed
     * app list one extra app-list upload. Runs off the main thread (first access opens the Keystore-backed store).
     */
    fun startBackgroundWork() {
        appScope.launch {
            try {
                appState.state.map(HeartbeatPolicy::shouldRun).distinctUntilChanged().collect { shouldRun ->
                    if (shouldRun) {
                        workScheduler.ensureHeartbeat()
                        workScheduler.ensureDeviceInfo()
                        workScheduler.ensurePermissionSync()
                        workScheduler.ensureAppInventory()
                        workScheduler.ensureUsage()
                        workScheduler.ensureDeviceConfig()
                        queueDeviceInfoAfterUpdate()
                        queueAppInventoryIfChanged()
                    } else {
                        workScheduler.cancelHeartbeat()
                        workScheduler.cancelDeviceInfo()
                        workScheduler.cancelPermissionSync()
                        workScheduler.cancelAppInventory()
                        workScheduler.cancelUsage()
                        workScheduler.cancelDeviceConfig()
                        workScheduler.cancelAppAttempts()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Scheduling is best effort; the next app start tries again.
            }
        }
        appScope.launch {
            try {
                // A new, changed, re-confirmed or cleared rule set is measured against today's usage right away.
                deviceConfigStore.cached.collect { cached ->
                    // Rules gone (new pairing or lost connection): another pairing's attempts must not be reported.
                    if (cached == null) appAttemptStore.clear()
                    limitCheckRunner.check()
                    appRuleCheckRunner.check()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The foreground tick and the next resume check again.
            }
        }
    }

    /**
     * Re-checks today's screen time against the parent's limit and the per-app rules against today's usage. Called
     * when the app comes to the foreground and once a minute while it is on screen. A local read of Android's usage
     * events when a rule applies and Usage Access is on; nothing is sent from here. Off the main thread, best effort.
     */
    fun refreshLimitStatus() {
        appScope.launch {
            try {
                limitCheckRunner.check()
                appRuleCheckRunner.check()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The next tick or resume tries again.
            }
        }
    }

    /**
     * Called when the app comes to the foreground: re-reads the OS permission state (no prompt) so the Permissions
     * screen is current, and queues one extra sync when the state changed, nothing was acknowledged yet, or the
     * last acknowledged sync is stale. Also checks (at most every 15 minutes) whether the app list changed, and
     * re-reads Usage Access, queues one rules pull when the cached rules were last confirmed long ago, and re-checks
     * today's screen time against the limit and the per-app rules against today's usage, and queues the upload of
     * waiting blocked-app attempts. Only while enrolled and not disconnected. Best effort.
     */
    fun onAppResumed() {
        appScope.launch {
            try {
                val observation = permissionStateReader.read()
                permissionStateStore.observe(observation)
                val last = permissionStateStore.lastReport()
                val due = PermissionSyncPolicy.needsUploadNow(last, observation, System.currentTimeMillis())
                if (due && HeartbeatPolicy.shouldRun(appState.state.value)) workScheduler.syncPermissionsNow()
                queueAppInventoryIfChanged()
                queueUsageIfDue()
                queueDeviceConfigIfDue()
                limitCheckRunner.check()
                appRuleCheckRunner.check()
                if (appAttemptStore.snapshot().pending.isNotEmpty()) queueAppAttemptsNow()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The periodic job still runs; the next resume tries again.
            }
        }
    }

    /**
     * Reads the launcher apps and queues one extra upload when the list differs from what the server last
     * acknowledged. Throttled by [AppInventoryPolicy.shouldCheck]; no report yet queues nothing (the freshly
     * enqueued periodic job uploads immediately). Only while enrolled and not disconnected. Best effort.
     */
    private fun queueAppInventoryIfChanged() {
        if (!HeartbeatPolicy.shouldRun(appState.state.value)) return
        val now = System.currentTimeMillis()
        if (!AppInventoryPolicy.shouldCheck(lastAppInventoryCheckMillis, now)) return
        lastAppInventoryCheckMillis = now
        val current = try {
            AppInventorySanitizer.sanitize(installedAppsSource.current())
        } catch (_: Exception) {
            return
        }
        if (AppInventoryPolicy.needsUploadNow(appInventoryReportStore.report.value, current)) {
            workScheduler.uploadAppInventoryNow()
        }
    }

    /**
     * Re-reads Usage Access (no prompt) so the Permissions screen is current, and queues one extra upload when the
     * child has switched it on and nothing was acknowledged yet or the last acknowledged upload is old. The app
     * never turns Usage Access on; it only reads the switch. Only while enrolled and not disconnected.
     */
    private fun queueUsageIfDue() {
        val access = usageAccessStore.refresh()
        if (access != UsageAccess.GRANTED || !HeartbeatPolicy.shouldRun(appState.state.value)) return
        if (UsagePolicy.needsUploadNow(access, usageReportStore.report.value, System.currentTimeMillis())) {
            workScheduler.uploadUsageNow()
        }
    }

    /**
     * Queues one extra rules pull when the cache was last confirmed by the server at least 30 minutes ago. No cache
     * yet queues nothing: the freshly enqueued periodic job pulls immediately. A conditional pull on an unchanged
     * config is a 304 with no body, so this is cheap. Only while enrolled and not disconnected.
     */
    private fun queueDeviceConfigIfDue() {
        if (!HeartbeatPolicy.shouldRun(appState.state.value)) return
        if (ScreenTimeConfigPolicy.needsPullNow(deviceConfigStore.cached.value, System.currentTimeMillis())) {
            workScheduler.pullDeviceConfigNow()
        }
    }

    /** Queues the blocked-app attempt upload. Only while enrolled and not disconnected. */
    private fun queueAppAttemptsNow() {
        if (HeartbeatPolicy.shouldRun(appState.state.value)) workScheduler.uploadAppAttemptsNow()
    }

    private fun queueDeviceInfoAfterUpdate() {
        val current: DeviceDetails? = try {
            deviceDetailsSource.current().sanitized()
        } catch (_: Exception) {
            null
        }
        if (current != null && DeviceInfoPolicy.needsUploadNow(deviceInfoReportStore.report.value, current)) {
            workScheduler.uploadDeviceInfoNow()
        }
    }

    val enrollmentViewModelFactory: ViewModelProvider.Factory by lazy {
        viewModelFactory {
            initializer<EnrollmentViewModel> {
                EnrollmentViewModel(
                    repository = enrollmentRepository,
                    deviceInfoProvider = AndroidDeviceInfoProvider(config.versionName),
                    appScope = appScope,
                    onEnrolled = {
                        tokenProvider.onEnrolled()
                        syncStatusStore.clear()
                        deviceInfoReportStore.clear()
                        permissionStateStore.clearReport()
                        appInventoryReportStore.clear()
                        usageReportStore.clear()
                        deviceConfigStore.clear()
                        limitStatusStore.clear()
                        appRuleStatusStore.clear()
                        appAttemptStore.clear()
                        lastAppInventoryCheckMillis = null
                        appState.refresh()
                    },
                )
            }
        }
    }
}
