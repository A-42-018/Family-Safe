package app.familysafe.child.data

/** What one attempt upload came to. No server text is ever kept. */
sealed interface AppAttemptResult {
    /** Recorded (or silently ignored by the server, which never says which). */
    data object Sent : AppAttemptResult

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : AppAttemptResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : AppAttemptResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : AppAttemptResult

    /** The server refused the batch itself (400, 413 and similar): it is dropped, repeating cannot help. */
    data object Rejected : AppAttemptResult
}

/** Pure status to result rules for `device-app-events` (docs/API.md). Same rules as the other device uploads. */
object AppAttemptHttpMapper {
    fun map(status: Int, retryAfterHeader: String?): AppAttemptResult = when {
        // The answer is `{ server_time }` only and never says what was stored or ignored: nothing to read.
        status in 200..299 -> AppAttemptResult.Sent
        // The executor already refreshed once; the next attempt refreshes again and learns about a revocation.
        status == 401 -> AppAttemptResult.RetryLater()
        status == 429 -> AppAttemptResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        // The server drops repeats within five minutes per package, so a repeated batch is harmless.
        status in 500..599 -> AppAttemptResult.RetryLater()
        else -> AppAttemptResult.Rejected
    }
}
