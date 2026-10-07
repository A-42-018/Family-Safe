package app.familysafe.child.domain

/** Whether this phone was set up with FamilySafe as Device Owner ("managed mode", Track B). Never a default. */
enum class ManagedModeState {
    /** A normal phone: FamilySafe can only inform (Track A). */
    NOT_MANAGED,

    /** FamilySafe is the Device Owner: it may pause apps the parent restricted. */
    DEVICE_OWNER,
}

/** Reads [ManagedModeState] from Android. A port so the rest of the app, and its tests, never touch the OS. */
interface ManagedModeDetector {
    fun state(): ManagedModeState
}

/** Pauses and resumes other apps through Device Owner rights. A port; the Android adapter is the only user of them. */
interface PackageSuspender {
    /**
     * Pauses ([suspended] = true) or resumes the given packages and returns the ones Android refused or that do not
     * exist. Never throws: any failure counts as "refused".
     */
    fun setSuspended(packages: Set<String>, suspended: Boolean): Set<String>

    /** Whether Android says the package is paused right now; null when it cannot be asked (not installed, no rights). */
    fun isSuspended(packageName: String): Boolean?
}
