package app.familysafe.child.data

import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionObservation
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one permission-state upload through [DeviceHttp] (the only code that adds a bearer token). The upload is
 * an idempotent overwrite on the server, so ANY network failure is simply "try again later". Nothing here logs.
 */
class PermissionSyncRepository(private val http: DeviceHttp) {
    suspend fun send(observation: PermissionObservation): PermissionSyncResult {
        val body = PermissionSyncWire.encode(dto(observation))
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return PermissionSyncResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                PermissionSyncHttpMapper.map(response.status, response.retryAfterHeader, response.body, observation)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> PermissionSyncResult.NotEnrolled
                TokenUnavailable.Disconnected -> PermissionSyncResult.Disconnected
                is TokenUnavailable.Retry -> PermissionSyncResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    private fun dto(observation: PermissionObservation): PermissionSyncRequestDto {
        fun name(key: PermissionKey): String = observation.states.getValue(key).name
        return PermissionSyncRequestDto(
            camera = name(PermissionKey.CAMERA),
            microphone = name(PermissionKey.MICROPHONE),
            contacts = name(PermissionKey.CONTACTS),
            sms = name(PermissionKey.SMS),
            callLog = name(PermissionKey.CALL_LOG),
            location = name(PermissionKey.LOCATION),
            preciseLocation = name(PermissionKey.PRECISE_LOCATION),
            backgroundLocation = name(PermissionKey.BACKGROUND_LOCATION),
        )
    }

    companion object {
        const val ENDPOINT = "device-permissions"
    }
}
