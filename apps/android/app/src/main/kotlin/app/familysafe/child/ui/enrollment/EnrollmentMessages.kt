package app.familysafe.child.ui.enrollment

import androidx.annotation.StringRes
import app.familysafe.child.R
import app.familysafe.child.domain.EnrollmentFailure

/** One generic, calm message per failure. Server text is never shown. */
object EnrollmentMessages {
    @StringRes
    fun of(failure: EnrollmentFailure): Int = when (failure) {
        EnrollmentFailure.InvalidFormat -> R.string.enrollment_error_format
        EnrollmentFailure.InvalidDeviceName -> R.string.enrollment_error_name
        EnrollmentFailure.InvalidCode -> R.string.enrollment_error_invalid_code
        is EnrollmentFailure.RateLimited -> R.string.enrollment_error_rate_limited
        EnrollmentFailure.Unreachable -> R.string.enrollment_error_unreachable
        EnrollmentFailure.Uncertain -> R.string.enrollment_error_uncertain
        EnrollmentFailure.ServerError -> R.string.enrollment_error_server
        EnrollmentFailure.Rejected -> R.string.enrollment_error_rejected
        EnrollmentFailure.StorageFailed -> R.string.enrollment_error_storage_failed
        EnrollmentFailure.StorageUnavailable -> R.string.enrollment_error_storage_unavailable
        EnrollmentFailure.AlreadyEnrolled -> R.string.enrollment_error_already
        EnrollmentFailure.Busy -> R.string.enrollment_error_busy
    }
}
