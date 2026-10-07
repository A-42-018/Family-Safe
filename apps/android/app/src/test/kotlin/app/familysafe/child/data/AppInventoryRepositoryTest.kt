package app.familysafe.child.data

import app.familysafe.child.domain.AppInventoryLimits
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppInventoryRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val apps = listOf(
        InstalledApp("com.b.b", "Bee", null, true),
        InstalledApp("com.a.a", "Ay", "2.0", false),
    )

    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    private val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""

    @Test
    fun `posts exactly the four contract keys per app to device-apps, sorted, nulls explicit`() {
        val http = FakeHttp { completed(200, ok) }
        runSuspend { AppInventoryRepository(http).send(apps) }
        val (endpoint, body) = http.calls.single()
        assertEquals("device-apps", endpoint)
        assertEquals(
            """{"apps":[""" +
                """{"package_name":"com.a.a","label":"Ay","version_name":"2.0","is_system":false},""" +
                """{"package_name":"com.b.b","label":"Bee","version_name":null,"is_system":true}]}""",
            body,
        )
    }

    @Test
    fun `the body never names a device or an identifier`() {
        val http = FakeHttp { completed(200, ok) }
        runSuspend { AppInventoryRepository(http).send(apps) }
        val body = http.calls.single().second
        for (word in listOf("device", "serial", "imei", "android_id", "advertising", "install_time", "version_code")) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `sanitizes before encoding and reports exactly what was shared`() {
        val http = FakeHttp { completed(200, ok) }
        val raw = listOf(
            InstalledApp("com.a.a", "  Ay\u0000  ", "  ", false),
            InstalledApp("not a package", "X", null, false),
            InstalledApp("com.a.a", "Duplicate", null, false),
        )
        val result = runSuspend { AppInventoryRepository(http).send(raw) } as AppInventoryResult.Sent
        assertEquals(
            """{"apps":[{"package_name":"com.a.a","label":"Ay","version_name":null,"is_system":false}]}""",
            http.calls.single().second,
        )
        assertEquals(listOf(InstalledApp("com.a.a", "Ay", null, false)), result.shared.apps)
        assertEquals(1, result.shared.omittedCount)
    }

    @Test
    fun `over 500 apps sends the first 500 by package name, never a rejected request`() {
        val http = FakeHttp { completed(200, ok) }
        val raw = (1..510).map { InstalledApp("com.example.app%04d".format(it), "App $it", "1", false) }
        val result = runSuspend { AppInventoryRepository(http).send(raw.reversed()) } as AppInventoryResult.Sent
        assertEquals(500, Regex("package_name").findAll(http.calls.single().second).count())
        assertEquals(10, result.shared.omittedCount)
        assertTrue(http.calls.single().second.contains("com.example.app0500"))
        assertFalse(http.calls.single().second.contains("com.example.app0501"))
    }

    @Test
    fun `a worst-case body stays under the edge limit`() {
        val http = FakeHttp { completed(200, ok) }
        val raw = (1..600).map {
            val pkg = "a." + "b".repeat(AppInventoryLimits.PACKAGE_MAX - 2 - 4) + "%04d".format(it)
            InstalledApp(pkg, "L".repeat(400), "9".repeat(400), true)
        }
        runSuspend { AppInventoryRepository(http).send(raw) }
        assertTrue(http.calls.single().second.toByteArray().size <= AppInventoryLimits.MAX_BODY_BYTES)
    }

    @Test
    fun `an empty or all-invalid reading is rejected without any request`() {
        val http = FakeHttp { completed(200, ok) }
        assertEquals(AppInventoryResult.Rejected, runSuspend { AppInventoryRepository(http).send(emptyList()) })
        val invalid = listOf(InstalledApp("nope", "X", null, false))
        assertEquals(AppInventoryResult.Rejected, runSuspend { AppInventoryRepository(http).send(invalid) })
        assertTrue(http.calls.isEmpty())
    }

    @Test
    fun `maps completed responses`() {
        val sent = runSuspend { AppInventoryRepository(FakeHttp { completed(200, ok) }).send(apps) }
        assertTrue(sent is AppInventoryResult.Sent && sent.serverTimeEpochMillis != null)
        assertEquals(
            AppInventoryResult.RetryLater(12),
            runSuspend { AppInventoryRepository(FakeHttp { completed(429, "", "12") }).send(apps) },
        )
        assertEquals(
            AppInventoryResult.Rejected,
            runSuspend { AppInventoryRepository(FakeHttp { completed(400) }).send(apps) },
        )
        assertEquals(
            AppInventoryResult.Rejected,
            runSuspend { AppInventoryRepository(FakeHttp { completed(413) }).send(apps) },
        )
    }

    @Test
    fun `the server time comes from the response body, not from the request`() {
        val result = runSuspend { AppInventoryRepository(FakeHttp { completed(200, ok) }).send(apps) }
        val expected = java.time.Instant.parse("2026-10-01T09:30:00.000Z").toEpochMilli()
        assertEquals(expected, (result as AppInventoryResult.Sent).serverTimeEpochMillis)
    }

    @Test
    fun `maps token problems`() {
        fun noToken(reason: TokenUnavailable) = FakeHttp { AuthedOutcome.NoToken(reason) }
        assertEquals(
            AppInventoryResult.NotEnrolled,
            runSuspend { AppInventoryRepository(noToken(TokenUnavailable.NotEnrolled)).send(apps) },
        )
        assertEquals(
            AppInventoryResult.Disconnected,
            runSuspend { AppInventoryRepository(noToken(TokenUnavailable.Disconnected)).send(apps) },
        )
        assertEquals(
            AppInventoryResult.RetryLater(40),
            runSuspend {
                AppInventoryRepository(noToken(TokenUnavailable.Retry(RetryReason.RateLimited, 40))).send(apps)
            },
        )
        assertEquals(
            AppInventoryResult.RetryLater(null),
            runSuspend { AppInventoryRepository(noToken(TokenUnavailable.Retry(RetryReason.Offline))).send(apps) },
        )
    }

    @Test
    fun `a network exception is a retry, cancellation is not swallowed`() {
        assertEquals(
            AppInventoryResult.RetryLater(),
            runSuspend { AppInventoryRepository(FakeHttp { throw IOException("down") }).send(apps) },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { AppInventoryRepository(FakeHttp { throw CancellationException("stop") }).send(apps) }
        }
    }
}
