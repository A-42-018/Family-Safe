package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.HeartbeatRepository
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.SyncStatusStore
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.HeartbeatPayload
import app.familysafe.child.domain.HeartbeatPayloadSource
import app.familysafe.child.domain.NetworkType
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class HeartbeatRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceHttp {
        var calls = 0

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls++
            return next()
        }
    }

    private val sync = SyncStatusStore(MapSecureStore())
    private val payloads = HeartbeatPayloadSource { HeartbeatPayload("0.12.0", "14", 60, true, NetworkType.Wifi) }
    private fun runner(http: Http, source: HeartbeatPayloadSource = payloads, now: Long = 1_234L) =
        HeartbeatRunner(source, HeartbeatRepository(http), sync) { now }

    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":900}}"""

    @Test
    fun `success records the server time as last sync`() {
        val result = runSuspend { runner(Http { done(200, ok) }).run() }
        assertEquals(HeartbeatRunResult.Sent, result)
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), sync.status.value.lastSyncEpochMillis)
    }

    @Test
    fun `success with an unreadable body falls back to the local clock`() {
        runSuspend { runner(Http { done(200, "x") }, now = 777L).run() }
        assertEquals(777L, sync.status.value.lastSyncEpochMillis)
    }

    @Test
    fun `retryable failures keep the previous last sync`() {
        sync.recordSuccess(42L)
        val cases = listOf(
            done(503),
            done(429),
            done(401),
            AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline)),
        )
        for (outcome in cases) {
            assertEquals(HeartbeatRunResult.Retry, runSuspend { runner(Http { outcome }).run() })
            assertEquals(42L, sync.status.value.lastSyncEpochMillis)
        }
    }

    @Test
    fun `a server refusal is a failure, not a retry storm`() {
        assertEquals(HeartbeatRunResult.Failed, runSuspend { runner(Http { done(400) }).run() })
    }

    @Test
    fun `disconnected or not enrolled stops the work and forgets the sync time`() {
        for (reason in listOf(TokenUnavailable.Disconnected, TokenUnavailable.NotEnrolled)) {
            sync.recordSuccess(42L)
            val result = runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }).run() }
            assertEquals(HeartbeatRunResult.Stopped, result)
            assertNull(sync.status.value.lastSyncEpochMillis)
        }
    }

    @Test
    fun `a payload source that throws fails the run without any request`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, HeartbeatPayloadSource { error("no battery") }).run() }
        assertEquals(HeartbeatRunResult.Failed, result)
        assertEquals(0, http.calls)
    }
}
