package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.DeviceInfoReportStore
import app.familysafe.child.data.DeviceInfoRepository
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.domain.DeviceDetailsSource
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DeviceInfoRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceHttp {
        var calls = 0

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls++
            return next()
        }
    }

    private val reports = DeviceInfoReportStore(MapSecureStore())
    private val details = DeviceDetails(34, "2025-09-05", 110_000, 50_000)
    private val source = DeviceDetailsSource { details }
    private val today = LocalDate.parse("2026-09-30")

    private fun runner(http: Http, src: DeviceDetailsSource = source, now: Long = 1_234L) =
        DeviceInfoRunner(src, DeviceInfoRepository(http) { today }, reports) { now }

    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""

    @Test
    fun `success records exactly what was shared, stamped with the server time`() {
        val result = runSuspend { runner(Http { done(200, ok) }).run() }
        assertEquals(DeviceInfoRunResult.Sent, result)
        val report = reports.report.value!!
        assertEquals(details, report.details)
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), report.sentAtEpochMillis)
    }

    @Test
    fun `what is recorded is the sanitized value, not the raw reading`() {
        val raw = DeviceDetailsSource { DeviceDetails(34, "junk", 5, 9) }
        runSuspend { runner(Http { done(200, ok) }, raw).run() }
        assertEquals(DeviceDetails(34, null, null, null), reports.report.value!!.details)
    }

    @Test
    fun `success with an unreadable body falls back to the local clock`() {
        runSuspend { runner(Http { done(200, "x") }, now = 777L).run() }
        assertEquals(777L, reports.report.value!!.sentAtEpochMillis)
    }

    @Test
    fun `retryable failures keep the previous report`() {
        runSuspend { runner(Http { done(200, ok) }).run() }
        val before = reports.report.value!!
        val cases = listOf(
            done(503),
            done(429),
            done(401),
            AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline)),
        )
        for (outcome in cases) {
            assertEquals(DeviceInfoRunResult.Retry, runSuspend { runner(Http { outcome }).run() })
            assertEquals(before.sentAtEpochMillis, reports.report.value!!.sentAtEpochMillis)
        }
    }

    @Test
    fun `a server refusal is a failure, not a retry storm`() {
        assertEquals(DeviceInfoRunResult.Failed, runSuspend { runner(Http { done(400) }).run() })
    }

    @Test
    fun `disconnected or not enrolled stops the work and forgets the report`() {
        for (reason in listOf(TokenUnavailable.Disconnected, TokenUnavailable.NotEnrolled)) {
            runSuspend { runner(Http { done(200, ok) }).run() }
            val result = runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }).run() }
            assertEquals(DeviceInfoRunResult.Stopped, result)
            assertNull(reports.report.value)
        }
    }

    @Test
    fun `a source that throws fails the run without any request`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, DeviceDetailsSource { error("no storage") }).run() }
        assertEquals(DeviceInfoRunResult.Failed, result)
        assertEquals(0, http.calls)
    }

    @Test
    fun `an unusable api level fails the run without any request`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, DeviceDetailsSource { DeviceDetails(0, null, null, null) }).run() }
        assertEquals(DeviceInfoRunResult.Failed, result)
        assertEquals(0, http.calls)
    }
}
