package app.familysafe.child.data

import app.familysafe.child.domain.HeartbeatPayload
import app.familysafe.child.domain.NetworkType
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HeartbeatRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val payload = HeartbeatPayload("0.12.0", "14", 73, isCharging = false, networkType = NetworkType.Cellular)
    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    @Test
    fun `posts exactly the five contract fields to device-heartbeat`() {
        val http = FakeHttp { completed(200) }
        runSuspend { HeartbeatRepository(http).send(payload) }
        val (endpoint, body) = http.calls.single()
        assertEquals("device-heartbeat", endpoint)
        assertEquals(
            """{"app_version":"0.12.0","android_version":"14","battery_level":73,"is_charging":false,""" +
                """"network_type":"CELLULAR"}""",
            body,
        )
    }

    @Test
    fun `the body never names a device`() {
        val http = FakeHttp { completed(200) }
        runSuspend { HeartbeatRepository(http).send(payload) }
        assertFalse(http.calls.single().second.contains("device"))
    }

    @Test
    fun `sends the sanitized payload`() {
        val http = FakeHttp { completed(200) }
        runSuspend {
            HeartbeatRepository(http).send(HeartbeatPayload(" 0.12.0 ", "14", 250, true, NetworkType.Wifi))
        }
        assertTrue(http.calls.single().second.contains(""""battery_level":100"""))
        assertTrue(http.calls.single().second.contains(""""app_version":"0.12.0""""))
    }

    @Test
    fun `an unusable payload is rejected without any request`() {
        val http = FakeHttp { completed(200) }
        val empty = HeartbeatPayload("", "14", 5, false, NetworkType.None)
        val result = runSuspend { HeartbeatRepository(http).send(empty) }
        assertEquals(HeartbeatResult.Rejected, result)
        assertTrue(http.calls.isEmpty())
    }

    @Test
    fun `maps completed responses`() {
        val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":900}}"""
        val sent = runSuspend { HeartbeatRepository(FakeHttp { completed(200, ok) }).send(payload) }
        assertTrue(sent is HeartbeatResult.Sent && sent.serverTimeEpochMillis != null)
        assertEquals(
            HeartbeatResult.RetryLater(12),
            runSuspend { HeartbeatRepository(FakeHttp { completed(429, "", "12") }).send(payload) },
        )
        assertEquals(
            HeartbeatResult.Rejected,
            runSuspend { HeartbeatRepository(FakeHttp { completed(400) }).send(payload) },
        )
    }

    @Test
    fun `maps token problems`() {
        fun noToken(reason: TokenUnavailable) = FakeHttp { AuthedOutcome.NoToken(reason) }
        assertEquals(
            HeartbeatResult.NotEnrolled,
            runSuspend { HeartbeatRepository(noToken(TokenUnavailable.NotEnrolled)).send(payload) },
        )
        assertEquals(
            HeartbeatResult.Disconnected,
            runSuspend { HeartbeatRepository(noToken(TokenUnavailable.Disconnected)).send(payload) },
        )
        assertEquals(
            HeartbeatResult.RetryLater(40),
            runSuspend {
                HeartbeatRepository(noToken(TokenUnavailable.Retry(RetryReason.RateLimited, 40))).send(payload)
            },
        )
        assertEquals(
            HeartbeatResult.RetryLater(null),
            runSuspend { HeartbeatRepository(noToken(TokenUnavailable.Retry(RetryReason.Offline))).send(payload) },
        )
    }

    @Test
    fun `a network exception is a retry, cancellation is not swallowed`() {
        assertEquals(
            HeartbeatResult.RetryLater(),
            runSuspend { HeartbeatRepository(FakeHttp { throw IOException("boom") }).send(payload) },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { HeartbeatRepository(FakeHttp { throw CancellationException("stop") }).send(payload) }
        }
    }
}
