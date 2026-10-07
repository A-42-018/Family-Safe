package app.familysafe.child.domain

/** Everything the six child-facing screens show. Immutable; `AppStateHolder` publishes it as a flow. */
data class ChildAppState(
    val enrollment: EnrollmentState = EnrollmentState.NotEnrolled,
    val auth: DeviceAuthState = DeviceAuthState.Unknown,
    val sync: SyncStatus = SyncStatus(),
    /** Device details the server last acknowledged; null until the first upload (and after a disconnect). */
    val deviceInfo: DeviceInfoReport? = null,
    val permissions: List<PermissionEntry> = PermissionCatalog.initial(),
    /** When the server last acknowledged the permission states; null until the first sync (and after a disconnect). */
    val permissionsSharedAtEpochMillis: Long? = null,
    /** The app list the server last acknowledged; null until the first upload (and after a disconnect). */
    val appInventory: AppInventoryReport? = null,
    /** The usage numbers the server last acknowledged; null until the first upload (and after a disconnect). */
    val usage: UsageReport? = null,
    /** Whether the child switched Usage Access on in Android settings (memory only, re-read on every resume). */
    val usageAccess: UsageAccess = UsageAccess.UNKNOWN,
    /** The parent's rules as the server last sent them; null until the first pull (and after a disconnect). */
    val screenTime: CachedScreenTimeConfig? = null,
    /** Today's screen time against the parent's limit, checked on this device (memory only). */
    val limit: LimitStatus = LimitStatus.Unchecked,
    /** The parent's per-app rules measured against today's usage, checked on this device (memory only). */
    val appRules: AppRuleStatus = AppRuleStatus.Unchecked,
) {
    val isEnrolled: Boolean get() = enrollment !is EnrollmentState.NotEnrolled
    val sharesAnything: Boolean get() = isEnrolled

    /** Credentials were rejected, expired or lost: nothing is shared until the child pairs again. */
    val isDisconnected: Boolean get() = !isEnrolled && auth.isDisconnected
}
