package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionState
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionSyncHttpMapperTest {
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""
    private val shared =
        PermissionObservation.create(PermissionCatalog.SYNCED.associateWith { PermissionState.GRANTED })!!

    private fun sent(result: PermissionSyncResult) = result as PermissionSyncResult.Sent

    @Test
    fun `2xx is sent with the server time and exactly what was shared`() {
        val result = sent(PermissionSyncHttpMapper.map(200, null, ok, shared))
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), result.serverTimeEpochMillis)
        assertSame(shared, result.shared)
    }

    @Test
    fun `an unreadable 2xx body is still sent, without a time`() {
        assertNull(sent(PermissionSyncHttpMapper.map(200, null, "not json", shared)).serverTimeEpochMillis)
        val badTime = """{"data":{"server_time":"soon"}}"""
        assertNull(sent(PermissionSyncHttpMapper.map(204, null, badTime, shared)).serverTimeEpochMillis)
    }

    @Test
    fun `401, 429 and every 5xx are retries`() {
        assertEquals(PermissionSyncResult.RetryLater(), PermissionSyncHttpMapper.map(401, null, "", shared))
        assertEquals(PermissionSyncResult.RetryLater(30), PermissionSyncHttpMapper.map(429, "30", "", shared))
        assertEquals(PermissionSyncResult.RetryLater(null), PermissionSyncHttpMapper.map(429, "soon", "", shared))
        for (status in listOf(500, 502, 503, 504, 599)) {
            val result = PermissionSyncHttpMapper.map(status, null, "", shared)
            assertEquals(PermissionSyncResult.RetryLater(), result, "$status")
        }
    }

    @Test
    fun `other 4xx and 3xx are refusals`() {
        for (status in listOf(300, 302, 400, 403, 404, 413, 422)) {
            val result = PermissionSyncHttpMapper.map(status, null, "", shared)
            assertEquals(PermissionSyncResult.Rejected, result, "$status")
        }
    }

    @Test
    fun `sent results never print their contents`() {
        assertTrue(sent(PermissionSyncHttpMapper.map(200, null, ok, shared)).toString() == "Sent")
    }
}
