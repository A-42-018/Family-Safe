package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.PermissionHistoryStore
import app.familysafe.child.data.PermissionStateReader
import app.familysafe.child.data.PermissionStateStore
import app.familysafe.child.data.PermissionSyncRepository
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionProbe
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PermissionSyncRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceHttp {
        var calls = 0

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls++
            return next()
        }
    }

    private class Probe : PermissionProbe {
        val granted = mutableSetOf<PermissionKey>()
        var broken = false

        override fun isAvailable(key: PermissionKey): Boolean =
            key != PermissionKey.SMS && key != PermissionKey.CALL_LOG

        override fun isGranted(key: PermissionKey): Boolean {
            check(!broken) { "probe failed" }
            return key in granted
        }
    }

    private val probe = Probe()
    private val states = PermissionStateStore(MapSecureStore())
    private val reader = PermissionStateReader(probe, PermissionHistoryStore(MapSecureStore()))
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""

    private fun runner(http: Http, now: Long = 1_234L) =
        PermissionSyncRunner(reader, PermissionSyncRepository(http), states) { now }

    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))

    @Test
    fun `success records exactly what was shared, stamped with the server time`() {
        probe.granted += PermissionKey.CAMERA
        assertEquals(PermissionSyncRunResult.Sent, runSuspend { runner(Http { done(200, ok) }).run() })
        val report = states.lastReport()!!
        assertEquals(PermissionState.GRANTED, report.observation.states.getValue(PermissionKey.CAMERA))
        assertEquals(PermissionState.NOT_AVAILABLE, report.observation.states.getValue(PermissionKey.SMS))
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), report.sentAtEpochMillis)
    }

    @Test
    fun `success with an unreadable body falls back to the local clock`() {
        runSuspend { runner(Http { done(200, "x") }, now = 777L).run() }
        assertEquals(777L, states.lastReport()!!.sentAtEpochMillis)
    }

    @Test
    fun `the screen shows the fresh reading even when the upload fails`() {
        probe.granted += PermissionKey.MICROPHONE
        assertEquals(PermissionSyncRunResult.Retry, runSuspend { runner(Http { done(503) }).run() })
        val shown = states.snapshot.value.entries.first { it.key == PermissionKey.MICROPHONE }
        assertEquals(PermissionState.GRANTED, shown.state)
        assertNull(states.lastReport())
    }

    @Test
    fun `retryable failures keep the previous report`() {
        runSuspend { runner(Http { done(200, ok) }).run() }
        val before = states.lastReport()!!
        val cases = listOf(
            done(503),
            done(429),
            done(401),
            AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline)),
        )
        for (outcome in cases) {
            assertEquals(PermissionSyncRunResult.Retry, runSuspend { runner(Http { outcome }).run() })
            assertEquals(before.sentAtEpochMillis, states.lastReport()!!.sentAtEpochMillis)
        }
    }

    @Test
    fun `a server refusal is a failure, not a retry storm`() {
        assertEquals(PermissionSyncRunResult.Failed, runSuspend { runner(Http { done(400) }).run() })
    }

    @Test
    fun `disconnected or not enrolled stops the work and forgets the report`() {
        for (reason in listOf(TokenUnavailable.Disconnected, TokenUnavailable.NotEnrolled)) {
            runSuspend { runner(Http { done(200, ok) }).run() }
            val result = runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }).run() }
            assertEquals(PermissionSyncRunResult.Stopped, result)
            assertNull(states.lastReport())
            assertNull(states.snapshot.value.sharedAtEpochMillis)
        }
    }

    @Test
    fun `a reading that throws fails the run without any request`() {
        probe.broken = true
        val http = Http { done(200, ok) }
        assertEquals(PermissionSyncRunResult.Failed, runSuspend { runner(http).run() })
        assertEquals(0, http.calls)
    }
}
