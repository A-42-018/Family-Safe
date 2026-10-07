package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.LimitReportRepository
import app.familysafe.child.data.LimitReportStore
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.LimitReportLimits
import app.familysafe.child.domain.LimitReportState
import app.familysafe.child.domain.PendingLimitReport
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class LimitReportRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceHttp {
        var calls = 0

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls++
            return next()
        }
    }

    private val now = Instant.parse("2026-10-05T12:00:00Z").toEpochMilli()
    private val store = LimitReportStore(MapSecureStore())
    private fun done(status: Int) = AuthedOutcome.Completed(RawResponse(status, "", null))
    private fun runner(http: Http, clock: Long = now) = LimitReportRunner(LimitReportRepository(http), store) { clock }
    private fun queue(at: Long = now) =
        store.update { LimitReportState("2026-10-04", PendingLimitReport("2026-10-05", at)) }

    @Test
    fun `nothing pending sends nothing`() {
        val http = Http { done(200) }
        assertEquals(LimitReportRunResult.Sent, runSuspend { runner(http).run() })
        assertEquals(0, http.calls)
    }

    @Test
    fun `a sent report leaves the outbox and marks the day done`() {
        queue()
        val http = Http { done(200) }
        assertEquals(LimitReportRunResult.Sent, runSuspend { runner(http).run() })
        assertEquals(1, http.calls)
        assertNull(store.snapshot().pending)
        assertEquals("2026-10-05", store.snapshot().lastReportedDay)
    }

    @Test
    fun `a refused report is dropped and the day is not queued again`() {
        queue()
        assertEquals(LimitReportRunResult.Failed, runSuspend { runner(Http { done(400) }).run() })
        assertNull(store.snapshot().pending)
        assertEquals("2026-10-05", store.snapshot().lastReportedDay)
    }

    @Test
    fun `a retryable failure keeps the report for the next run`() {
        queue()
        for (status in listOf(401, 429, 500, 503)) {
            assertEquals(
                LimitReportRunResult.Retry,
                runSuspend { runner(Http { done(status) }).run() },
                status.toString(),
            )
            assertEquals("2026-10-05", store.snapshot().pending?.day)
        }
        assertEquals(
            LimitReportRunResult.Retry,
            runSuspend { runner(Http { throw java.io.IOException("offline") }).run() },
        )
    }

    @Test
    fun `a report older than the server window is dropped without a request`() {
        queue(now - LimitReportLimits.MAX_AGE_MILLIS - 1)
        val http = Http { done(200) }
        assertEquals(LimitReportRunResult.Sent, runSuspend { runner(http).run() })
        assertEquals(0, http.calls)
        assertNull(store.snapshot().pending)
        assertEquals("2026-10-04", store.snapshot().lastReportedDay)
    }

    @Test
    fun `not enrolled or disconnected clears the store and stops the work`() {
        for (reason in listOf(TokenUnavailable.NotEnrolled, TokenUnavailable.Disconnected)) {
            queue()
            assertEquals(
                LimitReportRunResult.Stopped,
                runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }).run() },
            )
            assertEquals(LimitReportState(), store.snapshot())
        }
    }
}
