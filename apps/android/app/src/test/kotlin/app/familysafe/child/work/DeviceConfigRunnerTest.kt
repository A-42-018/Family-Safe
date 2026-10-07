package app.familysafe.child.work

import app.familysafe.child.data.AuthedOutcome
import app.familysafe.child.data.DeviceConfigRepository
import app.familysafe.child.data.DeviceConfigStore
import app.familysafe.child.data.DeviceGetHttp
import app.familysafe.child.data.RawResponse
import app.familysafe.child.data.RetryReason
import app.familysafe.child.data.TokenUnavailable
import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.runSuspend
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DeviceConfigRunnerTest {
    private class Http(var next: () -> AuthedOutcome) : DeviceGetHttp {
        val sent = mutableListOf<String?>()

        override suspend fun getJson(endpoint: String, ifNoneMatch: String?): AuthedOutcome {
            sent += ifNoneMatch
            return next()
        }
    }

    private val store = DeviceConfigStore(MapSecureStore())
    private fun runner(http: Http, now: Long = 1_234L) = DeviceConfigRunner(DeviceConfigRepository(http), store) { now }
    private fun done(status: Int, body: String = "") = AuthedOutcome.Completed(RawResponse(status, body, null))
    private fun body(version: Int, limit: Int = 60) = """
        {"data":{"config_version":$version,"daily_limit_minutes":$limit,"daily_limit_overrides":{},
        "app_rules":[],"timezone":null,"schedules":[],
        "server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}
    """.trimIndent()

    @Test
    fun `first pull caches the config, stamped with the local clock`() {
        val http = Http { done(200, body(3)) }
        assertEquals(DeviceConfigRunResult.Updated, runSuspend { runner(http, now = 777L).run() })
        assertEquals(listOf<String?>(null), http.sent)
        val cached = store.cached.value!!
        assertEquals(3, cached.config.version)
        assertEquals(60, cached.config.dailyLimitMinutes)
        assertEquals(777L, cached.validatedAtEpochMillis)
    }

    @Test
    fun `a newer version replaces the cache and the next pull is conditional on it`() {
        store.record(ScreenTimeConfig.validated(2, 30, emptyMap())!!, 5L)
        val http = Http { done(200, body(3, limit = 45)) }
        assertEquals(DeviceConfigRunResult.Updated, runSuspend { runner(http).run() })
        assertEquals(listOf<String?>("\"v2\""), http.sent)
        assertEquals(45, store.cached.value!!.config.dailyLimitMinutes)
        http.next = { done(304) }
        runSuspend { runner(http).run() }
        assertEquals("\"v3\"", http.sent.last())
    }

    @Test
    fun `304 only re-confirms the cached rules`() {
        store.record(ScreenTimeConfig.validated(2, 30, emptyMap())!!, 5L)
        assertEquals(DeviceConfigRunResult.Unchanged, runSuspend { runner(Http { done(304) }, now = 99L).run() })
        val cached = store.cached.value!!
        assertEquals(2, cached.config.version)
        assertEquals(30, cached.config.dailyLimitMinutes)
        assertEquals(99L, cached.validatedAtEpochMillis)
    }

    @Test
    fun `an expired cache is still sent as if-none-match so a 304 can revive it`() {
        store.record(ScreenTimeConfig.validated(2, 30, emptyMap())!!, 1L)
        val http = Http { done(304) }
        val now = 30L * 24 * 3_600_000
        assertEquals(DeviceConfigRunResult.Unchanged, runSuspend { runner(http, now).run() })
        assertEquals(listOf<String?>("\"v2\""), http.sent)
        assertEquals(now, store.cached.value!!.validatedAtEpochMillis)
    }

    @Test
    fun `retryable failures and refusals keep the cache untouched`() {
        store.record(ScreenTimeConfig.validated(2, 30, emptyMap())!!, 5L)
        val offline = AuthedOutcome.NoToken(TokenUnavailable.Retry(RetryReason.Offline))
        val retry = listOf(done(503), done(429), done(401), offline)
        for (outcome in retry) assertEquals(DeviceConfigRunResult.Retry, runSuspend { runner(Http { outcome }).run() })
        for (outcome in listOf(done(400), done(404), done(200, "junk"), done(200, body(0)))) {
            assertEquals(DeviceConfigRunResult.Failed, runSuspend { runner(Http { outcome }).run() })
        }
        val cached = store.cached.value!!
        assertEquals(2, cached.config.version)
        assertEquals(5L, cached.validatedAtEpochMillis)
    }

    @Test
    fun `not enrolled and disconnected stop the work and forget the rules`() {
        for (reason in listOf(TokenUnavailable.NotEnrolled, TokenUnavailable.Disconnected)) {
            store.record(ScreenTimeConfig.validated(2, 30, emptyMap())!!, 5L)
            val http = Http { AuthedOutcome.NoToken(reason) }
            assertEquals(DeviceConfigRunResult.Stopped, runSuspend { runner(http).run() })
            assertNull(store.cached.value)
        }
    }
}
