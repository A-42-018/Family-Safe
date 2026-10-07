package app.familysafe.child.data

import app.familysafe.child.domain.ScreenTimeConfig
import kotlin.coroutines.cancellation.CancellationException

/**
 * Pulls the current rules through [DeviceGetHttp] (the only code that adds a bearer token). Sends the cached version
 * as `If-None-Match` so an unchanged config costs a 304. The request is a read, so ANY network failure is simply
 * "try again later". Nothing here logs.
 */
class DeviceConfigRepository(private val http: DeviceGetHttp) {
    suspend fun fetch(cached: ScreenTimeConfig?): DeviceConfigResult {
        val outcome = try {
            http.getJson(ENDPOINT, cached?.etag())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return DeviceConfigResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                DeviceConfigHttpMapper.map(response.status, response.retryAfterHeader, response.body, cached?.version)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> DeviceConfigResult.NotEnrolled
                TokenUnavailable.Disconnected -> DeviceConfigResult.Disconnected
                is TokenUnavailable.Retry -> DeviceConfigResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-config"
    }
}
