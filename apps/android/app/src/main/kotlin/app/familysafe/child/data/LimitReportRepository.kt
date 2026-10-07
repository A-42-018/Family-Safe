package app.familysafe.child.data

import app.familysafe.child.domain.AppAttemptBatch
import app.familysafe.child.domain.PendingLimitReport
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one "daily limit reached" report through [DeviceHttp] (the only code that adds a bearer token). The time is
 * UTC whole seconds, the day is the device-local date. The server keeps one report per day, so repeating it is
 * harmless and ANY network failure is simply "try again later". Nothing here logs.
 */
class LimitReportRepository(private val http: DeviceHttp) {
    suspend fun send(report: PendingLimitReport): LimitReportResult {
        val body = LimitReportWire.encode(
            LimitReachedRequestDto(
                day = report.day,
                occurredAt = AppAttemptBatch.wireTime(report.occurredAtEpochMillis),
            ),
        )
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return LimitReportResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                LimitReportHttpMapper.map(response.status, response.retryAfterHeader)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> LimitReportResult.NotEnrolled
                TokenUnavailable.Disconnected -> LimitReportResult.Disconnected
                is TokenUnavailable.Retry -> LimitReportResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-limit-events"
    }
}
