package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetails
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.coroutines.cancellation.CancellationException

/**
 * Sends one device-info upload through [DeviceHttp] (the only code that adds a bearer token). The upload is an
 * idempotent overwrite on the server, so ANY network failure is simply "try again later". Nothing here logs.
 */
class DeviceInfoRepository(
    private val http: DeviceHttp,
    private val todayUtc: () -> LocalDate = { LocalDate.now(ZoneOffset.UTC) },
) {
    suspend fun send(details: DeviceDetails): DeviceInfoResult {
        val clean = details.sanitized(todayUtc()) ?: return DeviceInfoResult.Rejected
        val body = DeviceInfoWire.encode(
            DeviceInfoRequestDto(
                sdkLevel = clean.sdkLevel,
                securityPatch = clean.securityPatch,
                storageTotalMb = clean.storageTotalMb,
                storageFreeMb = clean.storageFreeMb,
            ),
        )
        val outcome = try {
            http.postJson(ENDPOINT, body)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return DeviceInfoResult.RetryLater()
        }
        return when (outcome) {
            is AuthedOutcome.Completed -> {
                val response = outcome.response
                DeviceInfoHttpMapper.map(response.status, response.retryAfterHeader, response.body, clean)
            }
            is AuthedOutcome.NoToken -> when (val reason = outcome.reason) {
                TokenUnavailable.NotEnrolled -> DeviceInfoResult.NotEnrolled
                TokenUnavailable.Disconnected -> DeviceInfoResult.Disconnected
                is TokenUnavailable.Retry -> DeviceInfoResult.RetryLater(reason.retryAfterSeconds)
            }
        }
    }

    companion object {
        const val ENDPOINT = "device-info"
    }
}
