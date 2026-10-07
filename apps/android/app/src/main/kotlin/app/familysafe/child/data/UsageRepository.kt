package app.familysafe.child.data

import app.familysafe.child.domain.DayUsage
import app.familysafe.child.domain.UsageSanitizer
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one day of usage through [DeviceHttp] (the only code that adds a bearer token). The reading is sanitized
 * here, before anything is encoded, so the request always satisfies the contract. The server keeps the larger value
 * per column, so ANY network failure is simply "try again later". Nothing here logs.
 */
class UsageRepository(private val http: DeviceHttp) {
    suspend fun send(raw: DayUsage): UsageResult {
        val usage = UsageSanitizer.sanitize(raw) ?: return UsageResult.Rejected
        val body = UsageWire.encode(
            UsageRequestDto(
                day = usage.day,
                totalScreenMinutes = usage.totalScreenMinutes,
                unlockCount = usage.unlockCount,
                apps = usage.apps.map { UsageAppDto(it.packageName, it.foregroundMinutes, it.launchCount) },
            ),
        )
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return UsageResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                UsageHttpMapper.map(response.status, response.retryAfterHeader, response.body, usage)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> UsageResult.NotEnrolled
                TokenUnavailable.Disconnected -> UsageResult.Disconnected
                is TokenUnavailable.Retry -> UsageResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-usage"
    }
}
