package app.familysafe.child.data

import app.familysafe.child.domain.AppInventory
import java.time.Instant

/** What one app-inventory upload attempt came to. No server text is ever kept. */
sealed interface AppInventoryResult {
    /** Recorded. [shared] is exactly what left the device (after sanitizing); [serverTimeEpochMillis] may be null. */
    class Sent(val serverTimeEpochMillis: Long?, val shared: AppInventory) : AppInventoryResult {
        override fun toString(): String = "Sent"
    }

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : AppInventoryResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : AppInventoryResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : AppInventoryResult

    /** The server refused the request itself (400, 413 and similar) or the reading was empty. */
    data object Rejected : AppInventoryResult
}

/** Pure status to result rules for `device-apps` (docs/API.md). Same rules as device-info and the heartbeat. */
object AppInventoryHttpMapper {
    fun map(status: Int, retryAfterHeader: String?, body: String, shared: AppInventory): AppInventoryResult = when {
        status in 200..299 -> AppInventoryResult.Sent(parseServerTime(body), shared)
        // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
        status == 401 -> AppInventoryResult.RetryLater()
        status == 429 -> AppInventoryResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        // A full replace is idempotent on the server, so retrying after any server failure is safe.
        status in 500..599 -> AppInventoryResult.RetryLater()
        else -> AppInventoryResult.Rejected
    }

    private fun parseServerTime(body: String): Long? = try {
        Instant.parse(AppInventoryWire.serverTime(body)).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
