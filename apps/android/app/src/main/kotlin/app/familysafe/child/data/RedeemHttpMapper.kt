package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentFailure

/** Pure status to outcome rules for `enrollment-redeem` (docs/API.md). Server message text is never used. */
object RedeemHttpMapper {
    private const val MAX_RETRY_AFTER_SECONDS = 86_400

    /**
     * @param parse turns a 2xx body into a [RedeemResponse]; only called for 2xx. Null or an exception means the
     *   server accepted the code but the answer is unusable, which is [EnrollmentFailure.Uncertain].
     */
    fun map(status: Int, retryAfterHeader: String?, body: String, parse: (String) -> RedeemResponse?): RedeemOutcome =
        when (status) {
            in 200..299 -> {
                val parsed = try {
                    parse(body)
                } catch (_: Exception) {
                    null
                }
                if (parsed != null) {
                    RedeemOutcome.Success(parsed)
                } else {
                    RedeemOutcome.Failure(EnrollmentFailure.Uncertain)
                }
            }
            401 -> RedeemOutcome.Failure(EnrollmentFailure.InvalidCode)
            429 -> RedeemOutcome.Failure(EnrollmentFailure.RateLimited(parseRetryAfter(retryAfterHeader)))
            in 500..599 -> RedeemOutcome.Failure(EnrollmentFailure.ServerError)
            else -> RedeemOutcome.Failure(EnrollmentFailure.Rejected)
        }

    /** Only the delta-seconds form; anything else (HTTP dates, junk, out of range) is "unknown". */
    fun parseRetryAfter(header: String?): Int? {
        val n = header?.trim()?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) && it.length <= 6 }?.toIntOrNull()
        return n?.takeIf { it in 1..MAX_RETRY_AFTER_SECONDS }
    }
}
