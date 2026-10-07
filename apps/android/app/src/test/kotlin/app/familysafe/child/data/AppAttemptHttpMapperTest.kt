package app.familysafe.child.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AppAttemptHttpMapperTest {
    @Test
    fun `any 2xx is sent, whatever the body (the answer never says what was stored)`() {
        for (status in listOf(200, 201, 204, 299)) {
            assertEquals(AppAttemptResult.Sent, AppAttemptHttpMapper.map(status, null), status.toString())
        }
    }

    @Test
    fun `401 after the executor's refresh is a retry, never a drop`() {
        assertEquals(AppAttemptResult.RetryLater(), AppAttemptHttpMapper.map(401, null))
    }

    @Test
    fun `429 keeps a delta-seconds Retry-After and ignores anything else`() {
        assertEquals(AppAttemptResult.RetryLater(30), AppAttemptHttpMapper.map(429, "30"))
        assertEquals(AppAttemptResult.RetryLater(null), AppAttemptHttpMapper.map(429, "Wed, 21 Oct 2026 07:28:00 GMT"))
        assertEquals(AppAttemptResult.RetryLater(null), AppAttemptHttpMapper.map(429, null))
    }

    @Test
    fun `every 5xx is a retry (repeats are harmless, the server drops them)`() {
        for (status in listOf(500, 502, 503, 504, 599)) {
            assertEquals(AppAttemptResult.RetryLater(), AppAttemptHttpMapper.map(status, null), status.toString())
        }
    }

    @Test
    fun `other 4xx and 3xx drop the batch`() {
        for (status in listOf(300, 304, 400, 403, 404, 413, 422)) {
            assertEquals(AppAttemptResult.Rejected, AppAttemptHttpMapper.map(status, null), status.toString())
        }
    }
}
