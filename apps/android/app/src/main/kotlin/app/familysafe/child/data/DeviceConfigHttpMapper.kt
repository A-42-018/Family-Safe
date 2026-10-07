package app.familysafe.child.data

import app.familysafe.child.domain.ParsedScreenTimeConfig
import app.familysafe.child.domain.ScreenTimeConfig

/** What one `device-config` pull came to. No server text is ever kept. */
sealed interface DeviceConfigResult {
    /** A new, contract-valid config. */
    class Fetched(val parsed: ParsedScreenTimeConfig) : DeviceConfigResult {
        override fun toString(): String = "Fetched"
    }

    /** 304: the cached [version] is still the server's. */
    class NotModified(val version: Int) : DeviceConfigResult {
        override fun toString(): String = "NotModified"
    }

    /** Never paired: nothing to pull, nothing to schedule. */
    data object NotEnrolled : DeviceConfigResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : DeviceConfigResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : DeviceConfigResult

    /** The server answered in a way that cannot be used (400 and similar, or an off-contract 200). Cache untouched. */
    data object Rejected : DeviceConfigResult
}

/** Pure status to result rules for `GET device-config` (docs/API.md). A read, so every server failure is retryable. */
object DeviceConfigHttpMapper {
    /** [sentVersion] = the version put in `If-None-Match`, or null when the app has no cached config. */
    fun map(status: Int, retryAfterHeader: String?, body: String, sentVersion: Int?): DeviceConfigResult = when {
        status == 200 ->
            DeviceConfigWire.parse(body)?.let { DeviceConfigResult.Fetched(it) } ?: DeviceConfigResult.Rejected
        // A 304 only makes sense as the answer to an If-None-Match we sent.
        status == 304 -> sentVersion?.let { DeviceConfigResult.NotModified(it) } ?: DeviceConfigResult.Rejected
        // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
        status == 401 -> DeviceConfigResult.RetryLater()
        status == 429 -> DeviceConfigResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        status in 500..599 -> DeviceConfigResult.RetryLater()
        else -> DeviceConfigResult.Rejected
    }
}
