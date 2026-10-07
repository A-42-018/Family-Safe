package app.familysafe.child.work

import app.familysafe.child.data.AppAttemptRepository
import app.familysafe.child.data.AppAttemptStore
import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceHttp
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.AppAttempt
import app.familysafe.child.domain.AppAttemptState
import app.familysafe.child.domain.AppRuleLimits
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppAttemptRunnerTest {
    private val noon = Instant.parse("2026-10-01T12:00:00Z").toEpochMilli()
    private val minute = 60_000L

    private class FakeHttp(var next: (Int) -> AuthedOutcome) : DeviceHttp {
        val bodies = mutableListOf<String>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            bodies += jsonBody
            return next(bodies.size)
        }
    }

    private fun ok(status: Int = 200) = AuthedOutcome.Completed(RawResponse(status, "{}", null))

    private val backing = MapSecureStore()
    private val store = AppAttemptStore(backing)

    private fun queue(count: Int, startAgoMinutes: Long = 60) = store.update {
        it.copy(
            rulesVersion = 1,
            watermarkMillis = noon,
            pending = (0 until count).map { i ->
                AppAttempt("com.example.app$i", noon - startAgoMinutes * minute + i * 1_000L)
            },
        )
    }

    private fun runner(http: FakeHttp) = AppAttemptRunner(AppAttemptRepository(http), store) { noon }

    private fun run(http: FakeHttp) = runSuspend { runner(http).run() }

    @Test
    fun `an empty outbox sends nothing`() {
        val http = FakeHttp { error("must not be called") }
        assertEquals(AppAttemptRunResult.Sent, run(http))
        assertTrue(http.bodies.isEmpty())
    }

    @Test
    fun `a sent batch leaves the outbox`() {
        queue(3)
        val http = FakeHttp { ok() }
        assertEquals(AppAttemptRunResult.Sent, run(http))
        assertEquals(1, http.bodies.size)
        assertTrue(store.snapshot().pending.isEmpty())
    }

    @Test
    fun `more than twenty attempts go in batches of twenty, oldest first`() {
        queue(25)
        val http = FakeHttp { ok() }
        assertEquals(AppAttemptRunResult.Sent, run(http))
        assertEquals(2, http.bodies.size)
        assertEquals(20, Regex("BLOCKED_APP_ATTEMPT").findAll(http.bodies[0]).count())
        assertEquals(5, Regex("BLOCKED_APP_ATTEMPT").findAll(http.bodies[1]).count())
        assertTrue(http.bodies[0].contains("com.example.app0\""))
        assertTrue(http.bodies[1].contains("com.example.app24\""))
        assertTrue(store.snapshot().pending.isEmpty())
    }

    @Test
    fun `a retryable failure keeps everything for the next run`() {
        queue(3)
        val offline = AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline))
        for (outcome in listOf(ok(503), ok(429), ok(401), offline)) {
            val http = FakeHttp { outcome }
            assertEquals(AppAttemptRunResult.Retry, run(http))
            assertEquals(3, store.snapshot().pending.size)
        }
    }

    @Test
    fun `a network exception is a retry and keeps the outbox`() {
        queue(2)
        assertEquals(AppAttemptRunResult.Retry, run(FakeHttp { throw IOException("down") }))
        assertEquals(2, store.snapshot().pending.size)
    }

    @Test
    fun `a refused batch is dropped and the run reports failure, later batches still go`() {
        queue(25)
        val http = FakeHttp { call -> if (call == 1) ok(400) else ok(200) }
        assertEquals(AppAttemptRunResult.Failed, run(http))
        assertEquals(2, http.bodies.size)
        assertTrue(store.snapshot().pending.isEmpty())
    }

    @Test
    fun `attempts too old for the server are dropped without a request`() {
        queue(2, startAgoMinutes = 24 * 60)
        val http = FakeHttp { error("must not be called") }
        assertEquals(AppAttemptRunResult.Sent, run(http))
        assertTrue(store.snapshot().pending.isEmpty())
        assertTrue(http.bodies.isEmpty())
    }

    @Test
    fun `not enrolled or disconnected stops the work and forgets the bookkeeping`() {
        for (reason in listOf(TokenUnavailable.NotEnrolled, TokenUnavailable.Disconnected)) {
            queue(2)
            assertEquals(AppAttemptRunResult.Stopped, run(FakeHttp { AuthedOutcome.NoToken(reason) }))
            assertEquals(AppAttemptState(), store.snapshot())
        }
    }

    @Test
    fun `the outbox is bounded so the run is bounded`() {
        queue(AppRuleLimits.OUTBOX_MAX)
        val http = FakeHttp { ok() }
        assertEquals(AppAttemptRunResult.Sent, run(http))
        assertEquals(2, http.bodies.size)
    }
}
