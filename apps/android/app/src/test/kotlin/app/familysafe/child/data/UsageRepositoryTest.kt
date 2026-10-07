package app.familysafe.child.data

import app.familysafe.child.domain.AppUsageEntry
import app.familysafe.child.domain.DayUsage
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class UsageRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val raw = DayUsage(
        day = "2026-10-01",
        totalScreenMinutes = 125,
        unlockCount = 7,
        apps = listOf(AppUsageEntry("com.b.b", 10, 1), AppUsageEntry("com.a.a", 60, 3)),
    )

    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""

    @Test
    fun `posts exactly the contract keys to device-usage, busiest app first`() {
        val http = FakeHttp { completed(200, ok) }
        runSuspend { UsageRepository(http).send(raw) }
        val (endpoint, body) = http.calls.single()
        assertEquals("device-usage", endpoint)
        assertEquals(
            """{"day":"2026-10-01","total_screen_minutes":125,"unlock_count":7,"apps":[""" +
                """{"package_name":"com.a.a","foreground_minutes":60,"launch_count":3},""" +
                """{"package_name":"com.b.b","foreground_minutes":10,"launch_count":1}]}""",
            body,
        )
    }

    @Test
    fun `an empty app list is a valid report`() {
        val http = FakeHttp { completed(200, ok) }
        runSuspend { UsageRepository(http).send(DayUsage("2026-10-01", 0, 0, emptyList())) }
        assertEquals("""{"day":"2026-10-01","total_screen_minutes":0,"unlock_count":0,"apps":[]}""", http.calls.single().second)
    }

    @Test
    fun `the body never names a device or an identifier`() {
        val http = FakeHttp { completed(200, ok) }
        runSuspend { UsageRepository(http).send(raw) }
        val body = http.calls.single().second
        for (word in listOf("device", "serial", "imei", "android_id", "advertising", "label", "app_name")) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `sanitizes before encoding and reports exactly what was shared`() {
        val http = FakeHttp { completed(200, ok) }
        val dirty = DayUsage(
            "2026-10-01",
            totalScreenMinutes = 9999,
            unlockCount = 123456,
            apps = listOf(
                AppUsageEntry("com.a.a", 50, 2),
                AppUsageEntry("not a package", 5, 1),
                AppUsageEntry("com.a.a", 70, 1),
                AppUsageEntry("com.z.z", 0, 0),
            ),
        )
        val result = runSuspend { UsageRepository(http).send(dirty) } as UsageResult.Sent
        assertEquals(
            """{"day":"2026-10-01","total_screen_minutes":1440,"unlock_count":10000,"apps":[""" +
                """{"package_name":"com.a.a","foreground_minutes":70,"launch_count":2}]}""",
            http.calls.single().second,
        )
        assertEquals(listOf(AppUsageEntry("com.a.a", 70, 2)), result.shared.apps)
        assertEquals(2, result.shared.omittedCount)
    }

    @Test
    fun `the worst-case body stays under the edge limit`() {
        val http = FakeHttp { completed(200, ok) }
        val many = (1..300).map { AppUsageEntry("a." + "b".repeat(250) + "%03d".format(it), 7, 10000) }
        runSuspend { UsageRepository(http).send(DayUsage("2026-10-01", 1440, 10000, many)) }
        // The Edge accepts 64 KiB per request (`MAX_BODY_BYTES`); 200 apps with 255-character names still fit.
        assertTrue(http.calls.single().second.toByteArray().size < 64 * 1024)
        assertEquals(200, Regex("package_name").findAll(http.calls.single().second).count())
    }

    @Test
    fun `a day that is not a real date is rejected without any request`() {
        val http = FakeHttp { completed(200, ok) }
        val result = runSuspend { UsageRepository(http).send(DayUsage("2026-02-30", 1, 1, emptyList())) }
        assertEquals(UsageResult.Rejected, result)
        assertTrue(http.calls.isEmpty())
    }

    @Test
    fun `maps completed responses`() {
        val sent = runSuspend { UsageRepository(FakeHttp { completed(200, ok) }).send(raw) }
        assertTrue(sent is UsageResult.Sent && sent.serverTimeEpochMillis != null)
        assertEquals(
            UsageResult.RetryLater(12),
            runSuspend { UsageRepository(FakeHttp { completed(429, "", "12") }).send(raw) },
        )
        assertEquals(
            UsageResult.RetryLater(),
            runSuspend { UsageRepository(FakeHttp { completed(503) }).send(raw) },
        )
        assertEquals(UsageResult.Rejected, runSuspend { UsageRepository(FakeHttp { completed(400) }).send(raw) })
        assertEquals(UsageResult.Rejected, runSuspend { UsageRepository(FakeHttp { completed(413) }).send(raw) })
    }

    @Test
    fun `maps token problems`() {
        assertEquals(
            UsageResult.NotEnrolled,
            runSuspend { UsageRepository(FakeHttp { AuthedOutcome.NoToken(TokenUnavailable.NotEnrolled) }).send(raw) },
        )
        assertEquals(
            UsageResult.Disconnected,
            runSuspend { UsageRepository(FakeHttp { AuthedOutcome.NoToken(TokenUnavailable.Disconnected) }).send(raw) },
        )
        assertEquals(
            UsageResult.RetryLater(),
            runSuspend {
                UsageRepository(FakeHttp { AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline)) }).send(raw)
            },
        )
    }

    @Test
    fun `any network failure is simply a later retry because the server keeps the larger value`() {
        val result = runSuspend { UsageRepository(FakeHttp { throw IOException("boom") }).send(raw) }
        assertEquals(UsageResult.RetryLater(), result)
    }

    @Test
    fun `cancellation is never swallowed`() {
        assertThrows(CancellationException::class.java) {
            runSuspend { UsageRepository(FakeHttp { throw CancellationException("stop") }).send(raw) }
        }
    }
}
