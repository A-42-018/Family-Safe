package app.familysafe.child.domain

/** Pure display rules for the usage features (JVM-testable; the Compose code only calls these). */
object UsageDisplay {
    /** How many apps the "shared with your parent" list shows by name; the rest is a count. */
    const val TOP_APPS = 5

    /**
     * Usage Access is a special switch in Android settings, not a runtime permission, so it has no "denied" or
     * "revoked" history: on means granted, anything else means "not turned on".
     */
    fun permissionState(access: UsageAccess): PermissionState = when (access) {
        UsageAccess.GRANTED -> PermissionState.GRANTED
        UsageAccess.NOT_GRANTED, UsageAccess.UNKNOWN -> PermissionState.NOT_REQUESTED
    }

    /** The Permissions list with the Usage Access row replaced by the live reading; every other row is untouched. */
    fun withUsageAccess(entries: List<PermissionEntry>, access: UsageAccess): List<PermissionEntry> =
        entries.map {
            if (it.key == PermissionKey.USAGE_ACCESS) PermissionEntry(it.key, permissionState(access)) else it
        }

    /** The apps shown by name: most minutes first, then most launches, then package name. */
    fun topApps(apps: List<AppUsageEntry>, limit: Int = TOP_APPS): List<AppUsageEntry> =
        apps.sortedWith(
            compareByDescending<AppUsageEntry> { it.foregroundMinutes }
                .thenByDescending { it.launchCount }
                .thenBy { it.packageName },
        ).take(limit)

    /** `45`, `60`, `125` minutes as hours and minutes parts: (0, 45), (1, 0), (2, 5). Negative reads as zero. */
    fun hoursAndMinutes(totalMinutes: Int): Pair<Int, Int> {
        val safe = totalMinutes.coerceAtLeast(0)
        return safe / 60 to safe % 60
    }
}
