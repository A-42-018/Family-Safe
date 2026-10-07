package app.familysafe.child.data

import app.familysafe.child.domain.ScreenTimeConfig
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class DeviceConfigRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceGetHttp {
        val calls = mutableListOf<Pair<String, String?>>()

        override suspend fun getJson(endpoint: String, ifNoneMatch: String?): AuthedOutcome {
            calls += endpoint to ifNoneMatch
            return next()
        }
    }

    private val cached = ScreenTimeConfig.validated(2, 60, emptyMap())!!
    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    @Test
    fun `gets device-config with the cached version as a strong etag`() {
        val http = FakeHttp { completed(304) }
        val result = runSuspend { DeviceConfigRepository(http).fetch(cached) }
        assertEquals("device-config" to "\"v2\"", http.calls.single())
        assertEquals(2, assertInstanceOf(DeviceConfigResult.NotModified::class.java, result).version)
    }

    @Test
    fun `without a cache the request is unconditional`() {
        val http = FakeHttp { completed(500) }
        runSuspend { DeviceConfigRepository(http).fetch(null) }
        assertNull(http.calls.single().second)
    }

    @Test
    fun `a 304 without a sent version is not trusted`() {
        val http = FakeHttp { completed(304) }
        assertEquals(DeviceConfigResult.Rejected, runSuspend { DeviceConfigRepository(http).fetch(null) })
    }

    @Test
    fun `token outcomes map to not enrolled, disconnected or retry`() {
        fun map(reason: TokenUnavailable) =
            runSuspend { DeviceConfigRepository(FakeHttp { AuthedOutcome.NoToken(reason) }).fetch(cached) }
        assertEquals(DeviceConfigResult.NotEnrolled, map(TokenUnavailable.NotEnrolled))
        assertEquals(DeviceConfigResult.Disconnected, map(TokenUnavailable.Disconnected))
        assertEquals(
            DeviceConfigResult.RetryLater(12),
            map(TokenUnavailable.Retry(RetryReason.RateLimited, 12)),
        )
        assertEquals(DeviceConfigResult.RetryLater(null), map(TokenUnavailable.Retry(RetryReason.Offline)))
    }

    @Test
    fun `any network exception is retry later because the call is a read`() {
        val http = FakeHttp { throw IOException("boom") }
        assertEquals(DeviceConfigResult.RetryLater(null), runSuspend { DeviceConfigRepository(http).fetch(cached) })
    }

    @Test
    fun `cancellation is never swallowed`() {
        val http = FakeHttp { throw CancellationException("stop") }
        assertThrows(CancellationException::class.java) { runSuspend { DeviceConfigRepository(http).fetch(cached) } }
    }
}
