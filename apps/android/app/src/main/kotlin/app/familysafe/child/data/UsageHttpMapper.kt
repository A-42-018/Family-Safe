package app.familysafe.child.data

import app.familysafe.child.domain.DayUsage
import java.time.Instant

/** What one usage upload attempt came to. No server text is ever kept. */
sealed interface UsageResult {
    /** Recorded. [shared] is exactly what left the device (after sanitizing); [serverTimeEpochMillis] may be null. */
    class Sent(val serverTimeEpochMillis: Long?, val shared: DayUsage) : UsageResult {
        override fun toString(): String = "Sent"
    }

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : UsageResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : UsageResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : UsageResult

    /** The server refused the request itself (400, 413 and similar) or the day could not be made valid. */
    data object Rejected : UsageResult
}

/** Pure status to result rules for `device-usage` (docs/API.md). Same rules as the other device uploads. */
object UsageHttpMapper {
    fun map(status: Int, retryAfterHeader: String?, body: String, shared: DayUsage): UsageResult = when {
        status in 200..299 -> UsageResult.Sent(parseServerTime(body), shared)
        // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
        status == 401 -> UsageResult.RetryLater()
        status == 429 -> UsageResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        // The server keeps the larger value per column, so a repeated upload is harmless.
        status in 500..599 -> UsageResult.RetryLater()
        else -> UsageResult.Rejected
    }

    private fun parseServerTime(body: String): Long? = try {
        Instant.parse(UsageWire.serverTime(body)).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
