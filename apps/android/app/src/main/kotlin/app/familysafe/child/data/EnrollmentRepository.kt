package app.familysafe.child.data

import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.domain.EnrollmentFailure
import app.familysafe.child.domain.EnrollmentResult
import app.familysafe.child.domain.EnrollmentState
import app.familysafe.child.domain.PairingCode
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Turns a typed pairing code into stored device credentials. Validation happens before any network call; a code is
 * never persisted; credentials are stored only after the server accepted the code.
 */
class EnrollmentRepository(
    private val api: EnrollmentApi,
    private val credentials: CredentialStore,
) {
    private val inFlight = AtomicBoolean(false)

    /** Unreadable storage reads as "not enrolled": the child can enroll again and a parent can revoke the old one. */
    fun currentState(): EnrollmentState = try {
        credentials.state()
    } catch (_: Exception) {
        EnrollmentState.NotEnrolled
    }

    suspend fun enroll(rawCode: String, device: DeviceInfo): EnrollmentResult {
        if (!inFlight.compareAndSet(false, true)) return failed(EnrollmentFailure.Busy)
        try {
            val existing = try {
                credentials.load()
            } catch (_: Exception) {
                return failed(EnrollmentFailure.StorageUnavailable)
            }
            if (existing != null) return failed(EnrollmentFailure.AlreadyEnrolled)
            val code = PairingCode.sanitizeTyped(rawCode).takeIf(PairingCode::isValid)
                ?: return failed(EnrollmentFailure.InvalidFormat)
            val info = device.sanitized() ?: return failed(EnrollmentFailure.InvalidDeviceName)

            if (!credentials.isWritable()) return failed(EnrollmentFailure.StorageUnavailable)

            val outcome = api.redeem(
                RedeemRequest(code, info.name, info.manufacturer, info.model, info.androidVersion, info.appVersion),
            )
            return when (outcome) {
                is RedeemOutcome.Failure -> failed(outcome.failure)
                is RedeemOutcome.Success -> save(outcome.response)
            }
        } finally {
            inFlight.set(false)
        }
    }

    private fun save(response: RedeemResponse): EnrollmentResult = try {
        credentials.save(
            DeviceCredentials(response.deviceId, response.refreshToken, response.refreshExpiresAtEpochMillis),
        )
        EnrollmentResult.Enrolled(EnrollmentState.Enrolled(response.deviceId))
    } catch (_: Exception) {
        failed(EnrollmentFailure.StorageFailed)
    }

    private fun failed(failure: EnrollmentFailure) = EnrollmentResult.Failed(failure)
}
