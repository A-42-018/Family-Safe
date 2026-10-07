package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.data.UsageReportStore
import app.familysafe.child.data.UsageRepository
import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import app.familysafe.child.domain.UsageEvent
import app.familysafe.child.domain.UsageEventKind
import app.familysafe.child.domain.UsageEventsSource
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.time.Instant
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class UsageRunnerTest {
    private class Http(var next: (Int) -> AuthedOutcome) : DeviceHttp {
        val bodies = mutableListOf<String>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            bodies += jsonBody
            return next(bodies.size)
        }
    }

    private class Source(var events: List<UsageEvent> = emptyList(), var failure: Boolean = false) : UsageEventsSource {
        val windows = mutableListOf<Pair<Long, Long>>()

        override fun events(windowStartMillis: Long, windowEndMillis: Long): List<UsageEvent> {
            windows += windowStartMillis to windowEndMillis
            if (failure) error("usage service unavailable")
            return events
        }
    }

    private val utc = ZoneId.of("UTC")
    private val now = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()
    private val todayStart = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli()
    private val yesterdayStart = Instant.parse("2026-09-30T00:00:00Z").toEpochMilli()
    private val reports = UsageReportStore(MapSecureStore())
    private var access = UsageAccess.GRANTED
    private val probe = UsageAccessProbe { access }

    private fun runner(http: Http, source: Source) =
        UsageRunner(probe, source, UsageRepository(http), reports, clock = { now }, zone = { utc })

    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))

    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""

    private fun open(pkg: String, at: String) =
        UsageEvent(UsageEventKind.FOREGROUND, pkg, Instant.parse(at).toEpochMilli())

    @Test
    fun `without usage access nothing is read and nothing is sent`() {
        val http = Http { done(200, ok) }
        val source = Source()
        for (state in listOf(UsageAccess.NOT_GRANTED, UsageAccess.UNKNOWN)) {
            access = state
            assertEquals(UsageRunResult.NoAccess, runSuspend { runner(http, source).run() })
        }
        assertTrue(source.windows.isEmpty())
        assertTrue(http.bodies.isEmpty())
        assertNull(reports.report.value)
    }

    @Test
    fun `the first upload sends yesterday and then today, each for its own local day`() {
        val http = Http { done(200, ok) }
        val source = Source()
        assertEquals(UsageRunResult.Sent, runSuspend { runner(http, source).run() })
        assertEquals(2, http.bodies.size)
        assertTrue(http.bodies[0].contains(""""day":"2026-09-30""""))
        assertTrue(http.bodies[1].contains(""""day":"2026-10-01""""))
        assertEquals(listOf(yesterdayStart to todayStart, todayStart to now), source.windows)
    }

    @Test
    fun `after that only today is sent until the local day changes`() {
        val http = Http { done(200, ok) }
        val source = Source()
        runSuspend { runner(http, source).run() }
        http.bodies.clear()
        source.windows.clear()
        assertEquals(UsageRunResult.Sent, runSuspend { runner(http, source).run() })
        assertEquals(1, http.bodies.size)
        assertEquals(listOf(todayStart to now), source.windows)
    }

    @Test
    fun `only the most recent day is remembered for the child, stamped with the server time`() {
        runSuspend { runner(Http { done(200, ok) }, Source()).run() }
        val report = reports.report.value!!
        assertEquals("2026-10-01", report.usage.day)
        assertEquals(Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli(), report.sentAtEpochMillis)
    }

    @Test
    fun `an unreadable success body falls back to the local clock`() {
        runSuspend { runner(Http { done(200, "x") }, Source()).run() }
        assertEquals(now, reports.report.value!!.sentAtEpochMillis)
    }

    @Test
    fun `an app that is still open is counted up to now, and only what the parent may see is sent`() {
        val http = Http { done(200, ok) }
        val source = Source(listOf(open("com.a.a", "2026-10-01T11:00:00Z")))
        runSuspend { runner(http, source).run() }
        val today = http.bodies.last()
        assertTrue(today.contains(""""total_screen_minutes":60"""))
        assertTrue(today.contains(""""package_name":"com.a.a","foreground_minutes":60,"launch_count":1"""))
        assertTrue(http.bodies.first().contains(""""apps":[]"""))
        assertEquals(60, reports.report.value!!.usage.apps.single().foregroundMinutes)
    }

    @Test
    fun `a source that throws reads as no access and sends nothing`() {
        val http = Http { done(200, ok) }
        val result = runSuspend { runner(http, Source(failure = true)).run() }
        assertEquals(UsageRunResult.NoAccess, result)
        assertTrue(http.bodies.isEmpty())
        assertNull(reports.report.value)
    }

    @Test
    fun `a retryable failure on yesterday stops before today and records nothing`() {
        val http = Http { done(503) }
        assertEquals(UsageRunResult.Retry, runSuspend { runner(http, Source()).run() })
        assertEquals(1, http.bodies.size)
        assertNull(reports.report.value)
    }

    @Test
    fun `yesterday recorded but today retried leaves the child's view untouched`() {
        val http = Http { call -> if (call == 1) done(200, ok) else done(429) }
        assertEquals(UsageRunResult.Retry, runSuspend { runner(http, Source()).run() })
        assertNull(reports.report.value)
    }

    @Test
    fun `every retryable outcome keeps the previous report`() {
        runSuspend { runner(Http { done(200, ok) }, Source()).run() }
        val before = reports.report.value!!
        val outcomes = listOf(
            done(503),
            done(429),
            done(401),
            AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline)),
        )
        for (outcome in outcomes) {
            assertEquals(UsageRunResult.Retry, runSuspend { runner(Http { outcome }, Source()).run() })
            assertEquals(before.sentAtEpochMillis, reports.report.value!!.sentAtEpochMillis)
        }
    }

    @Test
    fun `a server refusal fails this run without a retry storm and keeps the previous report`() {
        runSuspend { runner(Http { done(200, ok) }, Source()).run() }
        val before = reports.report.value!!
        assertEquals(UsageRunResult.Failed, runSuspend { runner(Http { done(400) }, Source()).run() })
        assertEquals(before.sentAtEpochMillis, reports.report.value!!.sentAtEpochMillis)
    }

    @Test
    fun `disconnected or not enrolled stops the work and forgets the report`() {
        for (reason in listOf(TokenUnavailable.Disconnected, TokenUnavailable.NotEnrolled)) {
            runSuspend { runner(Http { done(200, ok) }, Source()).run() }
            val result = runSuspend { runner(Http { AuthedOutcome.NoToken(reason) }, Source()).run() }
            assertEquals(UsageRunResult.Stopped, result)
            assertNull(reports.report.value)
        }
    }

    @Test
    fun `a daylight-saving day is read with real local midnights`() {
        val berlin = ZoneId.of("Europe/Berlin")
        val sunday = Instant.parse("2026-03-29T20:00:00Z").toEpochMilli()
        val source = Source()
        val runner = UsageRunner(
            probe,
            source,
            UsageRepository(Http { done(200, ok) }),
            UsageReportStore(MapSecureStore()),
            clock = { sunday },
            zone = { berlin },
        )
        runSuspend { runner.run() }
        val saturdayStart = Instant.parse("2026-03-27T23:00:00Z").toEpochMilli()
        val sundayStart = Instant.parse("2026-03-28T23:00:00Z").toEpochMilli()
        assertEquals(listOf(saturdayStart to sundayStart, sundayStart to sunday), source.windows)
    }
}
