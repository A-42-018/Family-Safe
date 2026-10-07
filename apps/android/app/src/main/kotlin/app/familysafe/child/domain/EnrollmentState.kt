package app.familysafe.child.domain

/** Whether this device is connected to a parent account. */
sealed interface EnrollmentState {
    data object NotEnrolled : EnrollmentState

    /** [deviceId] is an internal identifier: never shown in full, never logged (hence the fixed `toString`). */
    data class Enrolled(val deviceId: String) : EnrollmentState {
        override fun toString(): String = "Enrolled"
    }
}
