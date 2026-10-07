package app.familysafe.child.ui.navigation

/** The six child-facing screens (prompt §48). Pure, so route rules are unit-testable on the JVM. */
enum class Destination(val route: String) {
    DeviceStatus("device-status"),
    Permissions("permissions"),
    Enrollment("enrollment"),
    SyncStatus("sync-status"),
    Safety("safety"),
    About("about"),
    ;

    companion object {
        val start: Destination = DeviceStatus

        /** Screens reachable from the device-status home screen. */
        val secondary: List<Destination> = entries.filter { it != start }

        fun fromRoute(route: String?): Destination? = entries.firstOrNull { it.route == route }
    }
}
