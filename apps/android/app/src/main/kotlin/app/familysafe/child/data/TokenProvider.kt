package app.familysafe.child.data

import app.familysafe.child.domain.DeviceAuthState
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface AccessTokenResult {
    /** Never printed: the token is a bearer credential. */
    class Available(val token: String) : AccessTokenResult {
        override fun toString(): String = "Available"
    }

    data class Unavailable(val reason: TokenUnavailable) : AccessTokenResult
}

sealed interface TokenUnavailable {
    /** No credentials and no known reason: this device was never paired (or was paired and reset). */
    data object NotEnrolled : TokenUnavailable

    /** Credentials were rejected, expired or lost; they are gone and the child must pair again. */
    data object Disconnected : TokenUnavailable

    /** Nothing was lost; the same refresh token is still valid and a later attempt may work. */
    data class Retry(val reason: RetryReason, val retryAfterSeconds: Int? = null) : TokenUnavailable
}

enum class RetryReason { Offline, RateLimited, ServerBusy, Incompatible, StorageUnavailable }

/** What authenticated callers depend on. Implemented by [TokenProvider]; faked in tests. */
interface AccessTokenSource {
    /** A usable access token, refreshing first when the cached one is missing or about to expire. */
    suspend fun accessToken(): AccessTokenResult

    /**
     * The server answered 401 to [rejectedToken]. Returns a newer token if another caller already replaced it,
     * otherwise refreshes. Must not be used for the refresh call itself.
     */
    suspend fun refreshAfterUnauthorized(rejectedToken: String): AccessTokenResult

    /** A fresh token was rejected too: drop it so the next call refreshes (and discovers a revocation). */
    fun discard(rejectedToken: String)
}

/**
 * Holds the short-lived access token IN MEMORY ONLY and rotates the stored refresh token.
 *
 * Rules (docs/SECURITY.md, Phase 11b):
 * - single-flight: every refresh runs under one [Mutex], so two callers never present the same refresh token;
 * - the new refresh token is PERSISTED before the new access token is exposed;
 * - the network call and the save run in [NonCancellable]: a caller that gives up mid-request must not leave the
 *   server with a rotated token that this device never stored;
 * - a 401 clears the credentials ([DeviceAuthState.Revoked]); a response that may have been lost also clears them
 *   ([DeviceAuthState.Uncertain]) because presenting the old token again would count as reuse and revoke the family;
 * - only failures that provably happened before rotation (offline, 429, 502/503, other 4xx) keep the token.
 */
class TokenProvider(
    private val api: RefreshApi,
    private val credentials: CredentialStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : AccessTokenSource {
    private class Cached(val token: String, val expiresAtMillis: Long)

    private val mutex = Mutex()

    @Volatile
    private var cached: Cached? = null

    private val _authState = MutableStateFlow(initialState())
    val authState: StateFlow<DeviceAuthState> = _authState.asStateFlow()

    /** Called after a successful enrollment: whatever was cached or remembered no longer applies. */
    fun onEnrolled() {
        cached = null
        _authState.value = DeviceAuthState.Unknown
    }

    override suspend fun accessToken(): AccessTokenResult = mutex.withLock {
        freshCached()?.let { return@withLock AccessTokenResult.Available(it) }
        rotate()
    }

    override suspend fun refreshAfterUnauthorized(rejectedToken: String): AccessTokenResult = mutex.withLock {
        val current = freshCached()
        if (current != null && current != rejectedToken) return@withLock AccessTokenResult.Available(current)
        cached = null
        rotate()
    }

    override fun discard(rejectedToken: String) {
        if (cached?.token == rejectedToken) cached = null
    }

    private fun freshCached(): String? = cached?.takeIf { it.expiresAtMillis - clock() > REFRESH_MARGIN_MILLIS }?.token

    private suspend fun rotate(): AccessTokenResult {
        val stored = try {
            credentials.load()
        } catch (_: Exception) {
            return unavailable(TokenUnavailable.Retry(RetryReason.StorageUnavailable))
        }
        if (stored == null) {
            cached = null
            return unavailable(
                if (_authState.value.isDisconnected) TokenUnavailable.Disconnected else TokenUnavailable.NotEnrolled,
            )
        }
        if (stored.refreshExpiresAtEpochMillis <= clock()) {
            disconnect(DeviceAuthState.Expired)
            return unavailable(TokenUnavailable.Disconnected)
        }
        return withContext(NonCancellable) { exchange(stored) }
    }

    private suspend fun exchange(stored: DeviceCredentials): AccessTokenResult {
        val outcome = try {
            api.refresh(stored.refreshToken)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            RefreshOutcome.Failure(RefreshFailure.Uncertain)
        }
        return when (outcome) {
            is RefreshOutcome.Success -> accept(stored, outcome.tokens)
            is RefreshOutcome.Failure -> when (val failure = outcome.failure) {
                RefreshFailure.CredentialsRejected -> disconnected(DeviceAuthState.Revoked)
                RefreshFailure.Uncertain -> disconnected(DeviceAuthState.Uncertain)
                RefreshFailure.Unreachable -> unavailable(TokenUnavailable.Retry(RetryReason.Offline))
                is RefreshFailure.RateLimited ->
                    unavailable(TokenUnavailable.Retry(RetryReason.RateLimited, failure.retryAfterSeconds))
                RefreshFailure.ServerUnavailable -> unavailable(TokenUnavailable.Retry(RetryReason.ServerBusy))
                RefreshFailure.Rejected -> unavailable(TokenUnavailable.Retry(RetryReason.Incompatible))
            }
        }
    }

    /** Persist FIRST, expose second. */
    private fun accept(stored: DeviceCredentials, tokens: RefreshedTokens): AccessTokenResult {
        // The server rotated the token already; an answer for a different device is unusable.
        if (!tokens.deviceId.equals(stored.deviceId, ignoreCase = true)) {
            return disconnected(DeviceAuthState.Uncertain)
        }
        try {
            credentials.save(
                DeviceCredentials(stored.deviceId, tokens.refreshToken, tokens.refreshExpiresAtEpochMillis),
            )
        } catch (_: Exception) {
            return disconnected(DeviceAuthState.Uncertain)
        }
        val lifetimeMillis = tokens.accessExpiresInSeconds * MILLIS_PER_SECOND
        cached = Cached(tokens.accessToken, clock() + lifetimeMillis)
        _authState.value = DeviceAuthState.Connected
        return AccessTokenResult.Available(tokens.accessToken)
    }

    private fun disconnected(state: DeviceAuthState): AccessTokenResult {
        disconnect(state)
        return unavailable(TokenUnavailable.Disconnected)
    }

    private fun disconnect(state: DeviceAuthState) {
        cached = null
        try {
            credentials.clear()
            credentials.markDisconnected(state)
        } catch (_: Exception) {
            // Storage is broken; the state below is still correct for this process.
        }
        _authState.value = state
    }

    private fun unavailable(reason: TokenUnavailable) = AccessTokenResult.Unavailable(reason)

    private fun initialState(): DeviceAuthState = try {
        if (credentials.load() != null) {
            DeviceAuthState.Unknown
        } else {
            credentials.disconnectReason() ?: DeviceAuthState.Unknown
        }
    } catch (_: Exception) {
        DeviceAuthState.Unknown
    }

    companion object {
        /** Refresh when the access token has less than this left. */
        const val REFRESH_MARGIN_MILLIS = 60_000L
        private const val MILLIS_PER_SECOND = 1_000L
    }
}
