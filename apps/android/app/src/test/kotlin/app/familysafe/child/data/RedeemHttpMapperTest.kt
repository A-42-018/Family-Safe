package app.familysafe.child.data

import app.familysafe.child.domain.EnrollmentFailure
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RedeemHttpMapperTest {
    private val ok = RedeemResponse("11111111-2222-3333-4444-555555555555", "R".repeat(43), 1L)

    private fun map(status: Int, retryAfter: String? = null, parse: (String) -> RedeemResponse? = { ok }) =
        RedeemHttpMapper.map(status, retryAfter, "{}", parse)

    private fun failureOf(outcome: RedeemOutcome) = (outcome as RedeemOutcome.Failure).failure

    @Test
    fun `2xx with a usable body succeeds`() {
        assertInstanceOf(RedeemOutcome.Success::class.java, map(201))
        assertInstanceOf(RedeemOutcome.Success::class.java, map(200))
    }

    @Test
    fun `2xx with an unusable body is uncertain because the code is probably spent`() {
        assertEquals(EnrollmentFailure.Uncertain, failureOf(map(201) { null }))
        assertEquals(EnrollmentFailure.Uncertain, failureOf(map(201) { error("bad json") }))
    }

    @Test
    fun `401 is an invalid code and the body is never parsed`() {
        var parsed = false
        assertEquals(EnrollmentFailure.InvalidCode, failureOf(map(401) { parsed = true; ok }))
        assertFalse(parsed)
    }

    @Test
    fun `429 reads Retry-After seconds only`() {
        assertEquals(EnrollmentFailure.RateLimited(30), failureOf(map(429, "30")))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, null)))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, "soon")))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, "Wed, 21 Oct 2015 07:28:00 GMT")))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, "0")))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, "86401")))
        assertEquals(EnrollmentFailure.RateLimited(null), failureOf(map(429, "-5")))
    }

    @Test
    fun `5xx is a server error`() {
        listOf(500, 502, 503, 599).forEach { assertEquals(EnrollmentFailure.ServerError, failureOf(map(it))) }
    }

    @Test
    fun `other statuses mean the app and server disagree`() {
        listOf(100, 302, 400, 403, 404, 409, 422).forEach {
            assertEquals(EnrollmentFailure.Rejected, failureOf(map(it)))
        }
    }

    @Test
    fun `Retry-After parser`() {
        assertEquals(5, RedeemHttpMapper.parseRetryAfter(" 5 "))
        assertNull(RedeemHttpMapper.parseRetryAfter(""))
        assertNull(RedeemHttpMapper.parseRetryAfter("1234567"))
    }

    @Test
    fun `response fields are validated`() {
        val id = "2B0C1C48-1C7E-4C57-9D0F-5F3C3D0A9A11"
        val token = "abcDEF0123456789_-abcDEF0123456789_-xyz"
        val parsed = RedeemResponse.parse(id, token, "2026-10-30T12:00:00.000Z")!!
        assertEquals(id.lowercase(), parsed.deviceId)
        assertTrue(parsed.refreshExpiresAtEpochMillis > 0)
        assertNull(RedeemResponse.parse("not-a-uuid", token, "2026-10-30T12:00:00Z"))
        assertNull(RedeemResponse.parse(id, "short", "2026-10-30T12:00:00Z"))
        assertNull(RedeemResponse.parse(id, "has spaces ".repeat(5), "2026-10-30T12:00:00Z"))
        assertNull(RedeemResponse.parse(id, token, "tomorrow"))
    }
}
