package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentFailure
import java.time.Instant

/** Body of `POST enrollment-redeem`. Holds the pairing code, so `toString` is fixed. */
class RedeemRequest(
    val code: String,
    val deviceName: String,
    val manufacturer: String?,
    val model: String?,
    val androidVersion: String?,
    val appVersion: String?,
) {
    override fun toString(): String = "RedeemRequest"
}

/** What the app keeps from a successful redeem. The short-lived access token is dropped (Phase 11 refreshes). */
class RedeemResponse(
    val deviceId: String,
    val refreshToken: String,
    val refreshExpiresAtEpochMillis: Long,
) {
    override fun toString(): String = "RedeemResponse"

    companion object {
        private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val opaqueToken = Regex("^[A-Za-z0-9_-]{32,512}$")

        /** Null when the server's fields are not what the contract promises. */
        fun parse(deviceId: String, refreshToken: String, refreshExpiresAt: String): RedeemResponse? {
            if (!uuid.matches(deviceId) || !opaqueToken.matches(refreshToken)) return null
            val expiry = try {
                Instant.parse(refreshExpiresAt).toEpochMilli()
            } catch (_: java.time.format.DateTimeParseException) {
                return null
            }
            return RedeemResponse(deviceId.lowercase(), refreshToken, expiry)
        }
    }
}

sealed interface RedeemOutcome {
    class Success(val response: RedeemResponse) : RedeemOutcome {
        override fun toString(): String = "Success"
    }

    data class Failure(val failure: EnrollmentFailure) : RedeemOutcome
}

/** Talks to `enrollment-redeem`. Never throws for expected failures; never retries (not idempotent). */
interface EnrollmentApi {
    suspend fun redeem(request: RedeemRequest): RedeemOutcome
}
