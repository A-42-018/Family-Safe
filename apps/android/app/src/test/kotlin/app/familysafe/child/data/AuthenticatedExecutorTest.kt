package app.familysafe.child.data

import app.familysafe.child.testutil.runSuspend
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AuthenticatedExecutorTest {
    private class FakeSource(
        private val first: AccessTokenResult,
        private val second: AccessTokenResult = AccessTokenResult.Available("B"),
    ) : AccessTokenSource {
        var accessCalls = 0
        val refreshedAfter = mutableListOf<String>()
        val discarded = mutableListOf<String>()

        override suspend fun accessToken(): AccessTokenResult {
            accessCalls++
            return first
        }

        override suspend fun refreshAfterUnauthorized(rejectedToken: String): AccessTokenResult {
            refreshedAfter += rejectedToken
            return second
        }

        override fun discard(rejectedToken: String) {
            discarded += rejectedToken
        }
    }

    private fun response(status: Int) = RawResponse(status, "", null)

    private fun source(
        first: AccessTokenResult = AccessTokenResult.Available("A"),
        second: AccessTokenResult = AccessTokenResult.Available("B"),
    ) = FakeSource(first, second)

    private fun AuthedOutcome.status() = (assertInstanceOf(AuthedOutcome.Completed::class.java, this)).response.status

    @Test
    fun `sends once with the token and never refreshes on success`() {
        val s = source()
        val sent = mutableListOf<String>()
        val outcome = runSuspend {
            AuthenticatedExecutor(s).execute {
                sent += it
                response(200)
            }
        }
        assertEquals(200, outcome.status())
        assertEquals(listOf("A"), sent)
        assertEquals(emptyList<String>(), s.refreshedAfter)
    }

    @Test
    fun `one 401 refreshes once and repeats the request once with the new token`() {
        val s = source()
        val sent = mutableListOf<String>()
        val outcome = runSuspend {
            AuthenticatedExecutor(s).execute {
                sent += it
                response(if (it == "A") 401 else 200)
            }
        }
        assertEquals(200, outcome.status())
        assertEquals(listOf("A", "B"), sent)
        assertEquals(listOf("A"), s.refreshedAfter)
        assertEquals(emptyList<String>(), s.discarded)
    }

    @Test
    fun `a second 401 is returned, the fresh token is discarded and nothing loops`() {
        val s = source()
        val sent = mutableListOf<String>()
        val outcome = runSuspend {
            AuthenticatedExecutor(s).execute {
                sent += it
                response(401)
            }
        }
        assertEquals(401, outcome.status())
        assertEquals(listOf("A", "B"), sent)
        assertEquals(listOf("A"), s.refreshedAfter)
        assertEquals(listOf("B"), s.discarded)
    }

    @Test
    fun `other error statuses are not retried`() {
        for (status in listOf(400, 403, 404, 429, 500)) {
            val s = source()
            var sends = 0
            val outcome = runSuspend {
                AuthenticatedExecutor(s).execute {
                    sends++
                    response(status)
                }
            }
            assertEquals(status, outcome.status())
            assertEquals(1, sends)
        }
    }

    @Test
    fun `no token means nothing is sent`() {
        val none = AccessTokenResult.Unavailable(TokenUnavailable.Disconnected)
        var sends = 0
        val outcome = runSuspend {
            AuthenticatedExecutor(source(first = none)).execute {
                sends++
                response(200)
            }
        }
        assertEquals(AuthedOutcome.NoToken(TokenUnavailable.Disconnected), outcome)
        assertEquals(0, sends)
    }

    @Test
    fun `when the refresh after a 401 fails the request is not repeated`() {
        val none = AccessTokenResult.Unavailable(TokenUnavailable.Disconnected)
        var sends = 0
        val outcome = runSuspend {
            AuthenticatedExecutor(source(second = none)).execute {
                sends++
                response(401)
            }
        }
        assertEquals(AuthedOutcome.NoToken(TokenUnavailable.Disconnected), outcome)
        assertEquals(1, sends)
    }

    @Test
    fun `network exceptions from the request propagate to the caller`() {
        assertThrows(java.io.IOException::class.java) {
            runSuspend { AuthenticatedExecutor(source()).execute { throw java.io.IOException("down") } }
        }
    }

    @Test
    fun `responses never print their body`() {
        assertEquals("RawResponse(200)", RawResponse(200, "secret", null).toString())
    }
}
