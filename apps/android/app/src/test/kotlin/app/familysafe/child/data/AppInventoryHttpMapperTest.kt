package app.familysafe.child.data

import app.familysafe.child.domain.AppInventory
import app.familysafe.child.domain.InstalledApp
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppInventoryHttpMapperTest {
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""
    private val shared = AppInventory(listOf(InstalledApp("com.a.b", "A", "1", false)), 0)

    private fun sent(result: AppInventoryResult) = result as AppInventoryResult.Sent

    @Test
    fun `2xx is sent with the server time and exactly what was shared`() {
        val result = sent(AppInventoryHttpMapper.map(200, null, ok, shared))
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), result.serverTimeEpochMillis)
        assertSame(shared, result.shared)
    }

    @Test
    fun `an unreadable 2xx body is still sent, without a time`() {
        assertNull(sent(AppInventoryHttpMapper.map(200, null, "not json", shared)).serverTimeEpochMillis)
        val badTime = """{"data":{"server_time":"soon"}}"""
        assertNull(sent(AppInventoryHttpMapper.map(200, null, badTime, shared)).serverTimeEpochMillis)
    }

    @Test
    fun `401 after the executor's refresh means try again later`() {
        assertEquals(AppInventoryResult.RetryLater(), AppInventoryHttpMapper.map(401, null, "", shared))
    }

    @Test
    fun `429 keeps a delta-seconds Retry-After and drops junk`() {
        assertEquals(AppInventoryResult.RetryLater(30), AppInventoryHttpMapper.map(429, "30", "", shared))
        assertEquals(AppInventoryResult.RetryLater(null), AppInventoryHttpMapper.map(429, "soon", "", shared))
        assertEquals(AppInventoryResult.RetryLater(null), AppInventoryHttpMapper.map(429, null, "", shared))
    }

    @Test
    fun `any 5xx is a retry, other 4xx and 3xx are rejections`() {
        for (status in listOf(500, 502, 503, 599)) {
            val result = AppInventoryHttpMapper.map(status, null, "", shared)
            assertEquals(AppInventoryResult.RetryLater(), result, "$status")
        }
        for (status in listOf(301, 400, 403, 404, 413, 422)) {
            assertEquals(AppInventoryResult.Rejected, AppInventoryHttpMapper.map(status, null, "", shared), "$status")
        }
    }

    @Test
    fun `sent never prints app data`() {
        assertTrue(sent(AppInventoryHttpMapper.map(200, null, ok, shared)).toString() == "Sent")
    }
}
