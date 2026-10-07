package app.familysafe.child.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class RefreshHttpMapperTest {
    private val tokens = RefreshedTokens("11111111-2222-3333-4444-555555555555", "a.b.c", 900, "R".repeat(43), 1L)

    private fun map(status: Int, retryAfter: String? = null, parse: (String) -> RefreshedTokens? = { tokens }) =
        RefreshHttpMapper.map(status, retryAfter, "body", parse)

    @Test
    fun `200 with usable tokens is success`() {
        assertInstanceOf(RefreshOutcome.Success::class.java, map(200))
    }

    @Test
    fun `200 with an unusable body is uncertain because the token may be rotated`() {
        assertEquals(RefreshOutcome.Failure(RefreshFailure.Uncertain), map(200) { null })
        assertEquals(RefreshOutcome.Failure(RefreshFailure.Uncertain), map(200) { error("bad json") })
    }

    @Test
    fun `401 means the credentials are rejected`() {
        assertEquals(RefreshOutcome.Failure(RefreshFailure.CredentialsRejected), map(401))
    }

    @Test
    fun `429 keeps the token and reads delta seconds only`() {
        assertEquals(RefreshOutcome.Failure(RefreshFailure.RateLimited(30)), map(429, "30"))
        val httpDate = "Wed, 21 Oct 2026 07:28:00 GMT"
        assertEquals(RefreshOutcome.Failure(RefreshFailure.RateLimited(null)), map(429, httpDate))
        assertEquals(RefreshOutcome.Failure(RefreshFailure.RateLimited(null)), map(429, null))
    }

    @Test
    fun `only gateway 502 and 503 prove the function did not run`() {
        assertEquals(RefreshOutcome.Failure(RefreshFailure.ServerUnavailable), map(502))
        assertEquals(RefreshOutcome.Failure(RefreshFailure.ServerUnavailable), map(503))
    }

    @Test
    fun `other 5xx may follow a committed rotation and are uncertain`() {
        for (status in listOf(500, 504, 546, 599)) {
            assertEquals(RefreshOutcome.Failure(RefreshFailure.Uncertain), map(status), "status $status")
        }
    }

    @Test
    fun `other 4xx and redirects are rejected without touching the token`() {
        for (status in listOf(302, 400, 403, 404, 405, 413)) {
            assertEquals(RefreshOutcome.Failure(RefreshFailure.Rejected), map(status), "status $status")
        }
    }

    @Test
    fun `parse is not called for non-2xx answers`() {
        var called = false
        map(401) {
            called = true
            null
        }
        assertEquals(false, called)
    }
}
