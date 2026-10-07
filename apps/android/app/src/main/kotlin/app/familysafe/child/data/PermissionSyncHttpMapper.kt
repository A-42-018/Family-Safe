package app.familysafe.child.data

import app.familysafe.child.domain.PermissionObservation
import java.time.Instant

/** What one permission-sync attempt came to. No server text is ever kept. */
sealed interface PermissionSyncResult {
    /** Recorded. [shared] is exactly what left the device; [serverTimeEpochMillis] may be null. */
    class Sent(val serverTimeEpochMillis: Long?, val shared: PermissionObservation) : PermissionSyncResult {
        override fun toString(): String = "Sent"
    }

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : PermissionSyncResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : PermissionSyncResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : PermissionSyncResult

    /** The server refused the request itself (400 and similar). */
    data object Rejected : PermissionSyncResult
}

/** Pure status to result rules for `device-permissions`; identical to the heartbeat and device-info rules. */
object PermissionSyncHttpMapper {
    fun map(status: Int, retryAfterHeader: String?, body: String, shared: PermissionObservation): PermissionSyncResult =
        when {
            status in 200..299 -> PermissionSyncResult.Sent(parseServerTime(body), shared)
            // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
            status == 401 -> PermissionSyncResult.RetryLater()
            status == 429 -> PermissionSyncResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
            // The upload is an idempotent overwrite on the server, so retrying after any server failure is safe.
            status in 500..599 -> PermissionSyncResult.RetryLater()
            else -> PermissionSyncResult.Rejected
        }

    private fun parseServerTime(body: String): Long? = try {
        Instant.parse(PermissionSyncWire.serverTime(body)).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
