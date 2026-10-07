package app.familysafe.child.ui.enrollment

import app.familysafe.child.domain.DeviceInfoLimits
import app.familysafe.child.domain.DeviceText
import app.familysafe.child.domain.EnrollmentFailure
import app.familysafe.child.domain.EnrollmentResult
import app.familysafe.child.domain.PairingCode

/** Form state of the Enrollment screen. Pure and immutable, so every transition is unit-testable on the JVM. */
class EnrollmentUiState(
    /** Formatted for display (`XXXX-XXXX-…`). A credential: cleared as soon as it has been used or is known dead. */
    val codeText: String = "",
    val deviceName: String = "",
    val submitting: Boolean = false,
    val failure: EnrollmentFailure? = null,
) {
    val normalizedCode: String get() = PairingCode.sanitizeTyped(codeText)
    val codeIsComplete: Boolean get() = PairingCode.isValid(normalizedCode)
    val nameIsValid: Boolean get() = DeviceText.clean(deviceName, DeviceInfoLimits.NAME) != null
    val canSubmit: Boolean get() = !submitting && codeIsComplete && nameIsValid

    fun withCodeInput(raw: String): EnrollmentUiState =
        copy(codeText = PairingCode.format(PairingCode.sanitizeTyped(raw)), failure = null)

    fun withDeviceName(raw: String): EnrollmentUiState =
        copy(deviceName = DeviceText.limitTyped(raw, DeviceInfoLimits.NAME), failure = null)

    fun submitting(): EnrollmentUiState = copy(submitting = true, failure = null)

    /** What to tell the child when they press Connect but the form is incomplete; null when it can be submitted. */
    fun validationFailure(): EnrollmentFailure? = when {
        !codeIsComplete -> EnrollmentFailure.InvalidFormat
        !nameIsValid -> EnrollmentFailure.InvalidDeviceName
        else -> null
    }

    fun finished(result: EnrollmentResult): EnrollmentUiState = when (result) {
        // Success or spent code: the credential leaves memory.
        is EnrollmentResult.Enrolled -> copy(codeText = "", submitting = false, failure = null)
        is EnrollmentResult.Failed ->
            copy(
                codeText = if (result.failure.codeIsSpent) "" else codeText,
                submitting = false,
                failure = result.failure,
            )
    }

    fun copy(
        codeText: String = this.codeText,
        deviceName: String = this.deviceName,
        submitting: Boolean = this.submitting,
        failure: EnrollmentFailure? = this.failure,
    ) = EnrollmentUiState(codeText, deviceName, submitting, failure)

    /** Never prints the code. */
    override fun toString(): String = "EnrollmentUiState(submitting=$submitting, failure=$failure)"
}
