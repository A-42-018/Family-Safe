package app.familysafe.child.data

/** Pure status to outcome rules for `device-refresh` (docs/API.md). Server message text is never used. */
object RefreshHttpMapper {
    private val gatewayNotRun = setOf(502, 503)

    /**
     * @param parse turns a 2xx body into [RefreshedTokens]; only called for 2xx. Null or an exception means the
     *   server may have rotated the token but the answer is unusable, which is [RefreshFailure.Uncertain].
     */
    fun map(
        status: Int,
        retryAfterHeader: String?,
        body: String,
        parse: (String) -> RefreshedTokens?,
    ): RefreshOutcome = when {
        status in 200..299 -> {
            val parsed = try {
                parse(body)
            } catch (_: Exception) {
                null
            }
            if (parsed != null) {
                RefreshOutcome.Success(parsed)
            } else {
                RefreshOutcome.Failure(RefreshFailure.Uncertain)
            }
        }
        status == 401 -> RefreshOutcome.Failure(RefreshFailure.CredentialsRejected)
        status == 429 ->
            RefreshOutcome.Failure(RefreshFailure.RateLimited(RedeemHttpMapper.parseRetryAfter(retryAfterHeader)))
        status in gatewayNotRun -> RefreshOutcome.Failure(RefreshFailure.ServerUnavailable)
        // Our own sanitized 500 can be returned after the rotation committed (e.g. signing the JWT failed).
        status in 500..599 -> RefreshOutcome.Failure(RefreshFailure.Uncertain)
        // 3xx and other 4xx: redirects are off and the server never answers 3xx; nothing was rotated.
        else -> RefreshOutcome.Failure(RefreshFailure.Rejected)
    }
}
