package app.familysafe.child.di

import app.familysafe.child.data.EnrollmentRepository
import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.AppRuleStatus
import app.familysafe.child.domain.CachedScreenTimeConfig
import app.familysafe.child.domain.ChildAppState
import app.familysafe.child.domain.DeviceAuthState
import app.familysafe.child.domain.DeviceInfoReport
import app.familysafe.child.domain.LimitStatus
import app.familysafe.child.domain.PermissionSnapshot
import app.familysafe.child.domain.SyncStatus
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageReport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * App-wide [ChildAppState] as a flow. Enrollment is re-read on [refresh]; the auth state, the last sync time, the
 * last shared device details, the permission states, the last shared app list and usage numbers, the Usage Access
 * switch, the cached screen-time rules, today's limit check and the app-rule check are observed, so a revocation
 * discovered by the
 * token provider or a finished upload, pull or check reaches the screens without any extra call.
 */
class AppStateHolder(
    private val enrollment: EnrollmentRepository,
    authState: StateFlow<DeviceAuthState>,
    scope: CoroutineScope,
    syncStatus: StateFlow<SyncStatus> = MutableStateFlow(SyncStatus()),
    deviceInfo: StateFlow<DeviceInfoReport?> = MutableStateFlow(null),
    permissions: StateFlow<PermissionSnapshot> = MutableStateFlow(PermissionSnapshot.initial()),
    appInventory: StateFlow<AppInventoryReport?> = MutableStateFlow(null),
    usage: StateFlow<UsageReport?> = MutableStateFlow(null),
    usageAccess: StateFlow<UsageAccess> = MutableStateFlow(UsageAccess.UNKNOWN),
    screenTime: StateFlow<CachedScreenTimeConfig?> = MutableStateFlow(null),
    limit: StateFlow<LimitStatus> = MutableStateFlow(LimitStatus.Unchecked),
    appRules: StateFlow<AppRuleStatus> = MutableStateFlow(AppRuleStatus.Unchecked),
) {
    private val enrollmentVersion = MutableStateFlow(0)

    // `combine` has typed overloads for five flows only: the "what was shared" reports, the Usage Access state and
    // the rules group (cached rules + today's limit check) travel as one group.
    private class Rules(val cached: CachedScreenTimeConfig?, val limit: LimitStatus, val appRules: AppRuleStatus)

    private class Shared(
        val info: DeviceInfoReport?,
        val apps: AppInventoryReport?,
        val usage: UsageReport?,
        val access: UsageAccess,
        val rules: Rules,
    )

    private val rulesGroup =
        combine(screenTime, limit, appRules) { cached, status, apps -> Rules(cached, status, apps) }

    private val shared = combine(deviceInfo, appInventory, usage, usageAccess, rulesGroup) { a, b, c, d, e ->
        Shared(a, b, c, d, e)
    }

    val state: StateFlow<ChildAppState> = combine(
        enrollmentVersion,
        authState,
        syncStatus,
        shared,
        permissions,
    ) { _, auth, sync, reports, perms ->
        ChildAppState(
            enrollment = enrollment.currentState(),
            auth = auth,
            sync = sync,
            deviceInfo = reports.info,
            permissions = perms.entries,
            permissionsSharedAtEpochMillis = perms.sharedAtEpochMillis,
            appInventory = reports.apps,
            usage = reports.usage,
            usageAccess = reports.access,
            screenTime = reports.rules.cached,
            limit = reports.rules.limit,
            appRules = reports.rules.appRules,
        )
    }.stateIn(
        scope = scope,
        started = SharingStarted.Eagerly,
        initialValue = ChildAppState(
            enrollment = enrollment.currentState(),
            auth = authState.value,
            sync = syncStatus.value,
            deviceInfo = deviceInfo.value,
            permissions = permissions.value.entries,
            permissionsSharedAtEpochMillis = permissions.value.sharedAtEpochMillis,
            appInventory = appInventory.value,
            usage = usage.value,
            usageAccess = usageAccess.value,
            screenTime = screenTime.value,
            limit = limit.value,
            appRules = appRules.value,
        ),
    )

    fun refresh() {
        enrollmentVersion.update { it + 1 }
    }
}
