package app.familysafe.child.data

import app.familysafe.child.domain.HeartbeatPayload
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one heartbeat through [DeviceHttp] (the only code that adds a bearer token) and maps every way it can end.
 * A heartbeat is an idempotent overwrite on the server, so ANY network failure is simply "try again later" — unlike
 * enrollment or refresh there is no state that a lost answer could leave half-done. Nothing here logs.
 */
class HeartbeatRepository(private val http: DeviceHttp) {
    suspend fun send(payload: HeartbeatPayload): HeartbeatResult {
        val clean = payload.sanitized() ?: return HeartbeatResult.Rejected
        val body = HeartbeatWire.encode(
            HeartbeatRequestDto(
                appVersion = clean.appVersion,
                androidVersion = clean.androidVersion,
                batteryLevel = clean.batteryLevel,
                isCharging = clean.isCharging,
                networkType = clean.networkType.wire,
            ),
        )
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return HeartbeatResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                HeartbeatHttpMapper.map(response.status, response.retryAfterHeader, response.body)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> HeartbeatResult.NotEnrolled
                TokenUnavailable.Disconnected -> HeartbeatResult.Disconnected
                is TokenUnavailable.Retry -> HeartbeatResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-heartbeat"
    }
}
