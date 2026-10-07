package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetails
import java.time.Instant

/** What one device-info upload attempt came to. No server text is ever kept. */
sealed interface DeviceInfoResult {
    /** Recorded. [shared] is exactly what left the device (after sanitizing); [serverTimeEpochMillis] may be null. */
    class Sent(val serverTimeEpochMillis: Long?, val shared: DeviceDetails) : DeviceInfoResult {
        override fun toString(): String = "Sent"
    }

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : DeviceInfoResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : DeviceInfoResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : DeviceInfoResult

    /** The server refused the request itself (400 and similar) or there was nothing valid to send. */
    data object Rejected : DeviceInfoResult
}

/** Pure status to result rules for `device-info` (docs/API.md). Identical in spirit to the heartbeat rules. */
object DeviceInfoHttpMapper {
    fun map(status: Int, retryAfterHeader: String?, body: String, shared: DeviceDetails): DeviceInfoResult = when {
        status in 200..299 -> DeviceInfoResult.Sent(parseServerTime(body), shared)
        // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
        status == 401 -> DeviceInfoResult.RetryLater()
        status == 429 -> DeviceInfoResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        // The upload is an idempotent overwrite on the server, so retrying after any server failure is safe.
        status in 500..599 -> DeviceInfoResult.RetryLater()
        else -> DeviceInfoResult.Rejected
    }

    private fun parseServerTime(body: String): Long? = try {
        Instant.parse(DeviceInfoWire.serverTime(body)).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
