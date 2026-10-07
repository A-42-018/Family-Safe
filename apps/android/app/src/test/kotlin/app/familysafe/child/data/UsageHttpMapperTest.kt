package app.familysafe.child.data

import app.familysafe.child.domain.DayUsage
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class UsageHttpMapperTest {
    private val shared = DayUsage("2026-10-01", 10, 1, emptyList())
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""

    private fun map(status: Int, body: String = "", retryAfter: String? = null) =
        UsageHttpMapper.map(status, retryAfter, body, shared)

    @Test
    fun `2xx is sent and carries the server time and exactly what was shared`() {
        val result = map(200, ok) as UsageResult.Sent
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), result.serverTimeEpochMillis)
        assertSame(shared, result.shared)
        assertEquals(UsageResult.Sent::class, map(204, ok)::class)
    }

    @Test
    fun `a recorded upload with an unreadable body is still sent, without a server time`() {
        for (body in listOf("", "not json", "{}", """{"data":{}}""", """{"data":{"server_time":"soon"}}""")) {
            val result = map(200, body) as UsageResult.Sent
            assertNull(result.serverTimeEpochMillis, body)
            assertSame(shared, result.shared)
        }
    }

    @Test
    fun `401 and every 5xx are retried later`() {
        for (status in listOf(401, 500, 502, 503, 504, 599)) {
            assertEquals(UsageResult.RetryLater(), map(status), status.toString())
        }
    }

    @Test
    fun `429 keeps a numeric Retry-After and drops anything else`() {
        assertEquals(UsageResult.RetryLater(12), map(429, retryAfter = "12"))
        assertEquals(UsageResult.RetryLater(null), map(429))
        assertEquals(UsageResult.RetryLater(null), map(429, retryAfter = "Wed, 21 Oct 2026 07:28:00 GMT"))
    }

    @Test
    fun `the server refusing the request is final for this run`() {
        for (status in listOf(400, 403, 404, 405, 413, 422, 301, 302)) {
            assertEquals(UsageResult.Rejected, map(status), status.toString())
        }
    }

    @Test
    fun `nothing printable leaks the numbers`() {
        assertEquals("Sent", (map(200, ok) as UsageResult.Sent).toString())
    }
}
