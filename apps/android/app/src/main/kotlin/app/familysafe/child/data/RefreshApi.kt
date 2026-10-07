package app.familysafe.child.data

import java.time.Instant
import java.time.format.DateTimeParseException

/** Fresh tokens from `device-refresh`. The refresh token is ROTATED: the one that was sent is dead afterwards. */
class RefreshedTokens(
    val deviceId: String,
    val accessToken: String,
    val accessExpiresInSeconds: Int,
    val refreshToken: String,
    val refreshExpiresAtEpochMillis: Long,
) {
    override fun toString(): String = "RefreshedTokens"

    companion object {
        /** Mirrors `REFRESH_TOKEN_LENGTH` in packages/contracts/src/device-auth.ts. */
        const val REFRESH_TOKEN_LENGTH = 43
        private const val MAX_ACCESS_TOKEN_CHARS = 4096
        private const val MAX_ACCESS_LIFETIME_SECONDS = 3600

        private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val refreshToken = Regex("^[A-Za-z0-9_-]{$REFRESH_TOKEN_LENGTH}$")
        private val jwtShape = Regex("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")

        /** Null when the server's fields are not what the contract promises. */
        @Suppress("LongParameterList")
        fun parse(
            deviceId: String,
            tokenType: String,
            accessToken: String,
            accessExpiresIn: Int,
            refreshToken: String,
            refreshExpiresAt: String,
        ): RefreshedTokens? {
            if (!uuid.matches(deviceId) || tokenType != "Bearer") return null
            if (accessToken.length > MAX_ACCESS_TOKEN_CHARS || !jwtShape.matches(accessToken)) return null
            if (accessExpiresIn !in 1..MAX_ACCESS_LIFETIME_SECONDS) return null
            if (!this.refreshToken.matches(refreshToken)) return null
            val expiry = try {
                Instant.parse(refreshExpiresAt).toEpochMilli()
            } catch (_: DateTimeParseException) {
                return null
            }
            return RefreshedTokens(deviceId.lowercase(), accessToken, accessExpiresIn, refreshToken, expiry)
        }
    }
}

/**
 * Every way a refresh can end without new tokens. None carries server text.
 *
 * The important split is whether the server may already have ROTATED the token:
 * only [Unreachable], [RateLimited], [ServerUnavailable] and [Rejected] prove it did not, so only those keep the
 * stored refresh token. [Uncertain] must never be followed by another attempt with the same token (that would be
 * reuse, which revokes the whole family).
 */
sealed interface RefreshFailure {
    /** 401: unknown, expired, revoked or already-rotated token. The server deliberately does not say which. */
    data object CredentialsRejected : RefreshFailure

    /** The request certainly never reached the server (no network, DNS, refused, TLS handshake). */
    data object Unreachable : RefreshFailure

    /** 429: refused before any token was touched. */
    data class RateLimited(val retryAfterSeconds: Int?) : RefreshFailure

    /** 502/503 from the gateway: the function did not run. */
    data object ServerUnavailable : RefreshFailure

    /** Other 4xx: this app version and the server disagree; nothing was rotated. */
    data object Rejected : RefreshFailure

    /** Timeout after sending, dropped connection, other 5xx or an unusable 2xx: rotation may have happened. */
    data object Uncertain : RefreshFailure
}

sealed interface RefreshOutcome {
    class Success(val tokens: RefreshedTokens) : RefreshOutcome {
        override fun toString(): String = "Success"
    }

    data class Failure(val failure: RefreshFailure) : RefreshOutcome
}

/** Talks to `device-refresh`. Never throws for expected failures; never retries (not idempotent). */
interface RefreshApi {
    suspend fun refresh(refreshToken: String): RefreshOutcome
}
