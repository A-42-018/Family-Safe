package app.familysafe.child.data

import app.familysafe.child.domain.PendingLimitReport
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class LimitReportRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val report = PendingLimitReport("2026-10-05", Instant.parse("2026-10-05T09:30:00.987Z").toEpochMilli())
    private fun completed(status: Int, retryAfter: String? = null) = AuthedOutcome.Completed(
        RawResponse(status, """{"data":{"server_time":"2026-10-05T09:30:00.000Z"}}""", retryAfter),
    )

    @Test
    fun `posts exactly the two contract keys to device-limit-events`() {
        val http = FakeHttp { completed(200) }
        assertEquals(LimitReportResult.Sent, runSuspend { LimitReportRepository(http).send(report) })
        val (endpoint, body) = http.calls.single()
        assertEquals("device-limit-events", endpoint)
        assertEquals("""{"day":"2026-10-05","occurred_at":"2026-10-05T09:30:00Z"}""", body)
    }

    @Test
    fun `the body holds no usage numbers, app, label or identifier`() {
        val http = FakeHttp { completed(200) }
        runSuspend { LimitReportRepository(http).send(report) }
        val body = http.calls.single().second
        val words = listOf(
            "device", "serial", "imei", "android_id", "advertising", "label", "package", "app_name", "usage", "minutes",
            "limit",
        )
        for (word in words) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `status codes map like the other device uploads`() {
        fun send(status: Int, retryAfter: String? = null) =
            runSuspend { LimitReportRepository(FakeHttp { completed(status, retryAfter) }).send(report) }
        assertEquals(LimitReportResult.Sent, send(204))
        assertEquals(LimitReportResult.RetryLater(), send(401))
        assertEquals(LimitReportResult.RetryLater(30), send(429, "30"))
        assertEquals(LimitReportResult.RetryLater(), send(503))
        assertEquals(LimitReportResult.Rejected, send(400))
        assertEquals(LimitReportResult.Rejected, send(404))
    }

    @Test
    fun `token problems map to enrollment results`() {
        fun send(reason: TokenUnavailable) =
            runSuspend { LimitReportRepository(FakeHttp { AuthedOutcome.NoToken(reason) }).send(report) }
        assertEquals(LimitReportResult.NotEnrolled, send(TokenUnavailable.NotEnrolled))
        assertEquals(LimitReportResult.Disconnected, send(TokenUnavailable.Disconnected))
        assertEquals(LimitReportResult.RetryLater(7), send(TokenUnavailable.Retry(RetryReason.RateLimited, 7)))
    }

    @Test
    fun `any network failure is retry later but a cancellation is never swallowed`() {
        assertEquals(
            LimitReportResult.RetryLater(),
            runSuspend {
                LimitReportRepository(FakeHttp { throw IOException("offline") }).send(report)
            },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { LimitReportRepository(FakeHttp { throw CancellationException("stop") }).send(report) }
        }
    }
}
