package app.familysafe.child.data

/** Minimal HTTP answer for authenticated calls. The body may hold parent-visible data, so `toString` is fixed. */
class RawResponse(val status: Int, val body: String, val retryAfterHeader: String?) {
    override fun toString(): String = "RawResponse($status)"
}

sealed interface AuthedOutcome {
    /** The server answered (any status, including a second 401). */
    class Completed(val response: RawResponse) : AuthedOutcome {
        override fun toString(): String = "Completed"
    }

    /** No request was sent because no access token could be obtained. */
    data class NoToken(val reason: TokenUnavailable) : AuthedOutcome
}

/**
 * Runs one authenticated request: `Bearer` token from [AccessTokenSource]; on a single 401 it refreshes ONCE and
 * repeats the request ONCE (a 401 comes from the guard before any handler runs, so repeating is safe even for POST).
 * A second 401 is returned as is and the rejected token is discarded so the next call refreshes and discovers a
 * revocation. Never used for the refresh call itself (that endpoint takes no bearer token).
 * Network exceptions from [send] propagate to the caller, who knows whether its request is idempotent.
 */
class AuthenticatedExecutor(private val tokens: AccessTokenSource) {
    suspend fun execute(send: suspend (accessToken: String) -> RawResponse): AuthedOutcome {
        val first = when (val result = tokens.accessToken()) {
            is AccessTokenResult.Available -> result.token
            is AccessTokenResult.Unavailable -> return AuthedOutcome.NoToken(result.reason)
        }
        val firstResponse = send(first)
        if (firstResponse.status != UNAUTHORIZED) return AuthedOutcome.Completed(firstResponse)

        val second = when (val result = tokens.refreshAfterUnauthorized(first)) {
            is AccessTokenResult.Available -> result.token
            is AccessTokenResult.Unavailable -> return AuthedOutcome.NoToken(result.reason)
        }
        val secondResponse = send(second)
        if (secondResponse.status == UNAUTHORIZED) tokens.discard(second)
        return AuthedOutcome.Completed(secondResponse)
    }

    private companion object {
        const val UNAUTHORIZED = 401
    }
}
