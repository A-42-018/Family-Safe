package app.familysafe.child.data

import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.domain.AppAttemptBatch
import app.familysafe.child.domain.AppRuleLimits
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends blocked-app attempts through [DeviceHttp] (the only code that adds a bearer token). The batch is cut to what
 * the contract allows here, before anything is encoded (at most 20 usable attempts, times in UTC whole seconds), so
 * the request always satisfies it. Repeating a batch is harmless (the server drops repeats), so ANY network failure
 * is simply "try again later". Nothing here logs.
 */
class AppAttemptRepository(private val http: DeviceHttp) {
    /** Sends [attempts] (as returned by [AppAttemptBatch.next]). An empty list sends nothing and counts as sent. */
    suspend fun send(attempts: List<AppAttempt>): AppAttemptResult {
        if (attempts.isEmpty()) return AppAttemptResult.Sent
        val body = AppAttemptWire.encode(
            AppEventsRequestDto(
                attempts.take(AppRuleLimits.EVENTS_MAX).map {
                    val time = AppAttemptBatch.wireTime(it.occurredAtEpochMillis)
                    AppEventDto(AppAttemptWire.EVENT_TYPE, it.packageName, time)
                },
            ),
        )
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return AppAttemptResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                AppAttemptHttpMapper.map(response.status, response.retryAfterHeader)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> AppAttemptResult.NotEnrolled
                TokenUnavailable.Disconnected -> AppAttemptResult.Disconnected
                is TokenUnavailable.Retry -> AppAttemptResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-app-events"
    }
}
