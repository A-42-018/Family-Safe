package app.familysafe.child.data

import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class HeartbeatHttpMapperTest {
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":900}}"""

    @Test
    fun `2xx is sent with the server time`() {
        val expected = Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli()
        assertEquals(HeartbeatResult.Sent(expected), HeartbeatHttpMapper.map(200, null, ok))
    }

    @Test
    fun `an unreadable 2xx body is still sent, without a time`() {
        assertEquals(HeartbeatResult.Sent(null), HeartbeatHttpMapper.map(200, null, "not json"))
        val badTime = """{"data":{"server_time":"soon"}}"""
        assertEquals(HeartbeatResult.Sent(null), HeartbeatHttpMapper.map(200, null, badTime))
    }

    @Test
    fun `401 after the executor's refresh means try again later`() {
        assertEquals(HeartbeatResult.RetryLater(), HeartbeatHttpMapper.map(401, null, ""))
    }

    @Test
    fun `429 keeps a delta-seconds Retry-After and drops junk`() {
        assertEquals(HeartbeatResult.RetryLater(30), HeartbeatHttpMapper.map(429, "30", ""))
        val httpDate = "Wed, 21 Oct 2026 07:28:00 GMT"
        assertEquals(HeartbeatResult.RetryLater(null), HeartbeatHttpMapper.map(429, httpDate, ""))
    }

    @Test
    fun `any 5xx is retried because a heartbeat is an idempotent overwrite`() {
        for (code in listOf(500, 502, 503, 504)) {
            assertEquals(HeartbeatResult.RetryLater(), HeartbeatHttpMapper.map(code, null, ""))
        }
    }

    @Test
    fun `other 4xx and 3xx are rejected without retry`() {
        for (code in listOf(400, 403, 404, 413, 302)) {
            assertEquals(HeartbeatResult.Rejected, HeartbeatHttpMapper.map(code, null, ""))
        }
    }
}
