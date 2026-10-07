package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetails
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceInfoHttpMapperTest {
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""
    private val shared = DeviceDetails(34, "2025-09-05", 110_000, 50_000)

    private fun sent(result: DeviceInfoResult) = result as DeviceInfoResult.Sent

    @Test
    fun `2xx is sent with the server time and exactly what was shared`() {
        val result = sent(DeviceInfoHttpMapper.map(200, null, ok, shared))
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), result.serverTimeEpochMillis)
        assertSame(shared, result.shared)
    }

    @Test
    fun `an unreadable 2xx body is still sent, without a time`() {
        assertNull(sent(DeviceInfoHttpMapper.map(200, null, "not json", shared)).serverTimeEpochMillis)
        val badTime = """{"data":{"server_time":"soon"}}"""
        assertNull(sent(DeviceInfoHttpMapper.map(200, null, badTime, shared)).serverTimeEpochMillis)
    }

    @Test
    fun `401 after the executor's refresh means try again later`() {
        assertEquals(DeviceInfoResult.RetryLater(), DeviceInfoHttpMapper.map(401, null, "", shared))
    }

    @Test
    fun `429 keeps a delta-seconds Retry-After and drops junk`() {
        assertEquals(DeviceInfoResult.RetryLater(30), DeviceInfoHttpMapper.map(429, "30", "", shared))
        assertEquals(DeviceInfoResult.RetryLater(null), DeviceInfoHttpMapper.map(429, "soon", "", shared))
        assertEquals(DeviceInfoResult.RetryLater(null), DeviceInfoHttpMapper.map(429, null, "", shared))
    }

    @Test
    fun `any 5xx is a retry, other 4xx and 3xx are rejections`() {
        for (status in listOf(500, 502, 503, 599)) {
            assertEquals(DeviceInfoResult.RetryLater(), DeviceInfoHttpMapper.map(status, null, "", shared), "$status")
        }
        for (status in listOf(301, 400, 403, 404, 413, 422)) {
            assertEquals(DeviceInfoResult.Rejected, DeviceInfoHttpMapper.map(status, null, "", shared), "$status")
        }
    }

    @Test
    fun `sent never prints values`() {
        assertTrue(sent(DeviceInfoHttpMapper.map(200, null, ok, shared)).toString() == "Sent")
    }
}
