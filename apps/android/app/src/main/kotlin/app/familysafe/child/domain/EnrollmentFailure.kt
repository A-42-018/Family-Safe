package app.familysafe.child.domain

/** Every way enrolling can fail. Each maps to one calm, generic message; none carries server text. */
sealed interface EnrollmentFailure {
    /** The typed code is not 16 valid symbols. Nothing was sent. */
    data object InvalidFormat : EnrollmentFailure

    data object InvalidDeviceName : EnrollmentFailure

    /** Unknown, expired or already used: the server deliberately does not say which. */
    data object InvalidCode : EnrollmentFailure

    data class RateLimited(val retryAfterSeconds: Int?) : EnrollmentFailure

    /** The request certainly never reached the server (no network, DNS, refused, TLS handshake). Safe to retry. */
    data object Unreachable : EnrollmentFailure

    /** The request may have reached the server (timeout, connection lost, unreadable success): code may be spent. */
    data object Uncertain : EnrollmentFailure

    data object ServerError : EnrollmentFailure

    /** Any other 4xx: this app version and the server disagree. */
    data object Rejected : EnrollmentFailure

    /** The server accepted the code but the credentials could not be saved on this device. */
    data object StorageFailed : EnrollmentFailure

    /** Secure storage failed a pre-flight check, so nothing was sent and the code is still good. */
    data object StorageUnavailable : EnrollmentFailure

    data object AlreadyEnrolled : EnrollmentFailure

    data object Busy : EnrollmentFailure

    /** True when the code must not be reused, so the UI clears it (and the parent creates a new one). */
    val codeIsSpent: Boolean
        get() = this == InvalidCode || this == Uncertain || this == StorageFailed

    /** True when the parent may have to revoke the device and add it again. */
    val mayNeedParentRevoke: Boolean
        get() = this == Uncertain || this == StorageFailed || this == ServerError
}

sealed interface EnrollmentResult {
    data class Enrolled(val state: EnrollmentState.Enrolled) : EnrollmentResult

    data class Failed(val failure: EnrollmentFailure) : EnrollmentResult
}
