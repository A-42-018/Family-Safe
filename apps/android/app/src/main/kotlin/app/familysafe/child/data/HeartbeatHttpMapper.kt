package app.familysafe.child.data

import java.time.Instant

/** What one heartbeat attempt came to. No server text is ever kept. */
sealed interface HeartbeatResult {
    /** Recorded by the server. [serverTimeEpochMillis] is null when the answer body was unusable (still recorded). */
    data class Sent(val serverTimeEpochMillis: Long?) : HeartbeatResult

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : HeartbeatResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : HeartbeatResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : HeartbeatResult

    /** The server refused the request itself (400 and similar): a bug or a version mismatch, not worth retrying. */
    data object Rejected : HeartbeatResult
}

/** Pure status to result rules for `device-heartbeat` (docs/API.md). Server message text is never used. */
object HeartbeatHttpMapper {
    fun map(status: Int, retryAfterHeader: String?, body: String): HeartbeatResult = when {
        status in 200..299 -> HeartbeatResult.Sent(parseServerTime(body))
        // The executor already refreshed once. Still 401 = the next attempt refreshes again and finds out for sure
        // whether the device was revoked (then the refresh call itself answers 401 and we disconnect).
        status == 401 -> HeartbeatResult.RetryLater()
        status == 429 -> HeartbeatResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        // Heartbeat is an idempotent overwrite, so retrying after any server failure is safe.
        status in 500..599 -> HeartbeatResult.RetryLater()
        else -> HeartbeatResult.Rejected
    }

    private fun parseServerTime(body: String): Long? = try {
        Instant.parse(HeartbeatWire.serverTime(body)).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
