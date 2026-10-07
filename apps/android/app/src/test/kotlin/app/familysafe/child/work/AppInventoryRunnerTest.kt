package app.familysafe.child.work

import app.familysafe.child.data.AppInventoryReportStore
import app.familysafe.child.data.AppInventoryRepository
import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.domain.InstalledAppsSource
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AppInventoryRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceHttp {
        var calls = 0

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls++
            return next()
        }
    }

    private val reports = AppInventoryReportStore(MapSecureStore())
    private val apps = listOf(InstalledApp("com.b.b", "Bee", null, true), InstalledApp("com.a.a", "Ay", "2.0", false))
    private val source = InstalledAppsSource { apps }

    private fun runner(http: Http, src: InstalledAppsSource = source, now: Long = 1_234L) =
        AppInventoryRunner(src, AppInventoryRepository(http), reports) { now }

    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))
    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""

    @Test
    fun `success records exactly what was shared, stamped with the server time`() {
        val result = runSuspend { runner(Http { done(200, ok) }).run() }
        assertEquals(AppInventoryRunResult.Sent, result)
        val report = reports.report.value!!
        assertEquals(listOf("com.a.a", "com.b.b"), report.inventory.apps.map { it.packageName })
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), report.sentAtEpochMillis)
    }

    @Test
    fun `what is recorded is the sanitized list, not the raw reading`() {
        val raw = InstalledAppsSource {
            listOf(InstalledApp("com.a.a", "  Ay ", "", false), InstalledApp("bad", "X", null, false))
        }
        runSuspend { runner(Http { done(200, ok) }, raw).run() }
        val inventory = reports.report.value!!.inventory
        assertEquals(listOf(InstalledApp("com.a.a", "Ay", null, false)), inventory.apps)
        assertEquals(1, inventory.omittedCount)
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
            assertEquals(AppInventoryRunResult.Retry, runSuspend { runner(Http { outcome }).run() })
            assertEquals(before.sentAtEpochMillis, reports.report.value!!.sentAtEpochMillis)
        }
    }

    @Test
    fun `a server refusal is a failure, not a retry storm, and keeps the previous report`() {
        runSuspend { runner(Http { done(200, ok) }).run() }
        val before = reports.report.value!!
        assertEquals(AppInventoryRunResult.Failed, runSuspend { runner(Http { done(400) }).run() })
        assertEquals(before.sentAtEpochMillis, reports.report.value!!.sentAtEpochMillis)
    }

    @Test
    fun `disconnected or not enrolled stops the work and forgets the report`() {
        for (reason in listOf(TokenUnavailable.Disconnected, TokenUnavailable.NotEnrolled)) {
            runSuspend { runner(Http { done(200, ok) }).run() }
            val result = runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }).run() }
            assertEquals(AppInventoryRunResult.Stopped, result)
            assertNull(reports.report.value)
        }
    }

    @Test
    fun `a source that throws fails the run without any request`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, InstalledAppsSource { error("no package manager") }).run() }
        assertEquals(AppInventoryRunResult.Failed, result)
        assertEquals(0, http.calls)
    }

    @Test
    fun `an empty reading fails the run without any request and never wipes the parent's list`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, InstalledAppsSource { emptyList() }).run() }
        assertEquals(AppInventoryRunResult.Failed, result)
        assertEquals(0, http.calls)
    }
}
