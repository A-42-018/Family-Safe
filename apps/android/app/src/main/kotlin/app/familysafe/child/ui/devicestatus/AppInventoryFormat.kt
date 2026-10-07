package app.familysafe.child.ui.devicestatus

import app.familysafe.child.domain.InstalledApp

/** Which of the three "second line" layouts a row of the shared-apps list uses (pure, so it is JVM-testable). */
enum class AppRowDetail { Plain, Version, System, VersionAndSystem }

object AppInventoryFormat {
    fun detailOf(app: InstalledApp): AppRowDetail = when {
        app.versionName != null && app.isSystem -> AppRowDetail.VersionAndSystem
        app.versionName != null -> AppRowDetail.Version
        app.isSystem -> AppRowDetail.System
        else -> AppRowDetail.Plain
    }

    /** The list is sorted by package name for the contract; the child reads it by app name. Stable for equal names. */
    fun byName(
        apps: List<InstalledApp>,
        compare: Comparator<String> = String.CASE_INSENSITIVE_ORDER,
    ): List<InstalledApp> = apps.sortedWith(compareBy(compare) { it.label })
}
