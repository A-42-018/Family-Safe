package app.familysafe.child.data

import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppAttemptRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val t1 = Instant.parse("2026-10-01T09:30:00Z").toEpochMilli()
    private val t2 = Instant.parse("2026-10-01T09:41:07Z").toEpochMilli()

    private fun completed(status: Int, retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, serverTimeBody, retryAfter))

    private val serverTimeBody = """{"data":{"server_time":"2026-10-01T09:30:00.000Z"}}"""

    @Test
    fun `posts exactly the contract keys to device-app-events`() {
        val http = FakeHttp { completed(200) }
        val result = runSuspend {
            AppAttemptRepository(http).send(
                listOf(AppAttempt("com.example.game", t1), AppAttempt("com.example.chat", t2 + 400)),
            )
        }
        assertEquals(AppAttemptResult.Sent, result)
        val (endpoint, body) = http.calls.single()
        assertEquals("device-app-events", endpoint)
        assertEquals(
            """{"events":[""" +
                """{"type":"BLOCKED_APP_ATTEMPT","package_name":"com.example.game",""" +
                """"occurred_at":"2026-10-01T09:30:00Z"},""" +
                """{"type":"BLOCKED_APP_ATTEMPT","package_name":"com.example.chat",""" +
                """"occurred_at":"2026-10-01T09:41:07Z"}]}""",
            body,
        )
    }

    @Test
    fun `the body names no device, no label and no identifier`() {
        val http = FakeHttp { completed(200) }
        runSuspend { AppAttemptRepository(http).send(listOf(AppAttempt("com.example.game", t1))) }
        val body = http.calls.single().second
        val words = listOf(
            "device", "serial", "imei", "android_id", "advertising", "label", "app_name", "usage", "minutes",
        )
        for (word in words) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `an empty list sends nothing and counts as sent`() {
        val http = FakeHttp { error("must not be called") }
        assertEquals(AppAttemptResult.Sent, runSuspend { AppAttemptRepository(http).send(emptyList()) })
        assertTrue(http.calls.isEmpty())
    }

    @Test
    fun `never more than twenty events in one body`() {
        val http = FakeHttp { completed(200) }
        val many = (0 until 25).map { AppAttempt("com.example.app$it", t1 + it * 1_000L) }
        runSuspend { AppAttemptRepository(http).send(many) }
        assertEquals(20, Regex("BLOCKED_APP_ATTEMPT").findAll(http.calls.single().second).count())
    }

    @Test
    fun `statuses map like the other uploads`() {
        fun send(next: () -> AuthedOutcome) =
            runSuspend { AppAttemptRepository(FakeHttp(next)).send(listOf(AppAttempt("com.example.a", t1))) }
        assertEquals(AppAttemptResult.RetryLater(), send { completed(401) })
        assertEquals(AppAttemptResult.RetryLater(12), send { completed(429, "12") })
        assertEquals(AppAttemptResult.RetryLater(), send { completed(503) })
        assertEquals(AppAttemptResult.Rejected, send { completed(400) })
        assertEquals(AppAttemptResult.Rejected, send { completed(413) })
    }

    @Test
    fun `token problems map to their own results`() {
        fun send(reason: TokenUnavailable) = runSuspend {
            val repository = AppAttemptRepository(FakeHttp { AuthedOutcome.NoToken(reason) })
            repository.send(listOf(AppAttempt("com.example.a", t1)))
        }
        assertEquals(AppAttemptResult.NotEnrolled, send(TokenUnavailable.NotEnrolled))
        assertEquals(AppAttemptResult.Disconnected, send(TokenUnavailable.Disconnected))
        assertEquals(AppAttemptResult.RetryLater(7), send(TokenUnavailable.Retry(RetryReason.RateLimited, 7)))
        assertEquals(AppAttemptResult.RetryLater(null), send(TokenUnavailable.Retry(RetryReason.Offline)))
    }

    @Test
    fun `any network failure is a retry (the server drops repeats), cancellation is not swallowed`() {
        val attempts = listOf(AppAttempt("com.example.a", t1))
        assertEquals(
            AppAttemptResult.RetryLater(),
            runSuspend { AppAttemptRepository(FakeHttp { throw IOException("boom") }).send(attempts) },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { AppAttemptRepository(FakeHttp { throw CancellationException("stop") }).send(attempts) }
        }
    }
}
