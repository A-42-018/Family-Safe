package app.familysafe.child.data

/** What one limit-report upload came to. No server text is ever kept. */
sealed interface LimitReportResult {
    /** Recorded (or silently ignored by the server, which never says which). */
    data object Sent : LimitReportResult

    /** Never paired: nothing to send, nothing to schedule. */
    data object NotEnrolled : LimitReportResult

    /** Credentials were rejected, expired or lost; the child must pair again. */
    data object Disconnected : LimitReportResult

    /** Nothing was lost; a later attempt may work (offline, rate limit, server busy, still rejected after refresh). */
    data class RetryLater(val retryAfterSeconds: Int? = null) : LimitReportResult

    /** The server refused the report itself (400 and similar): it is dropped, repeating cannot help. */
    data object Rejected : LimitReportResult
}

/** Pure status to result rules for `device-limit-events` (docs/API.md). Same rules as the other device uploads. */
object LimitReportHttpMapper {
    fun map(status: Int, retryAfterHeader: String?): LimitReportResult = when {
        status in 200..299 -> LimitReportResult.Sent
        status == 401 -> LimitReportResult.RetryLater()
        status == 429 -> LimitReportResult.RetryLater(RedeemHttpMapper.parseRetryAfter(retryAfterHeader))
        status in 500..599 -> LimitReportResult.RetryLater()
        else -> LimitReportResult.Rejected
    }
}
