package app.familysafe.child.data

import app.familysafe.child.domain.PermissionCatalog
import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionObservation
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionSyncRepositoryTest {
    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val mixed = PermissionObservation.create(
        PermissionCatalog.SYNCED.associateWith {
            when (it) {
                PermissionKey.CAMERA -> PermissionState.GRANTED
                PermissionKey.SMS, PermissionKey.CALL_LOG -> PermissionState.NOT_AVAILABLE
                PermissionKey.LOCATION -> PermissionState.REVOKED
                PermissionKey.MICROPHONE -> PermissionState.DENIED
                else -> PermissionState.NOT_REQUESTED
            }
        },
    )!!

    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    @Test
    fun `posts exactly the eight contract keys to device-permissions`() {
        val http = FakeHttp { completed(200) }
        runSuspend { PermissionSyncRepository(http).send(mixed) }
        val (endpoint, body) = http.calls.single()
        assertEquals("device-permissions", endpoint)
        assertEquals(
            """{"camera":"GRANTED","microphone":"DENIED","contacts":"NOT_REQUESTED","sms":"NOT_AVAILABLE",""" +
                """"call_log":"NOT_AVAILABLE","location":"REVOKED","precise_location":"NOT_REQUESTED",""" +
                """"background_location":"NOT_REQUESTED"}""",
            body,
        )
    }

    @Test
    fun `the body never names a device or an identifier`() {
        val http = FakeHttp { completed(200) }
        runSuspend { PermissionSyncRepository(http).send(mixed) }
        val body = http.calls.single().second
        for (word in listOf("device", "serial", "imei", "android_id", "advertising", "package")) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `maps completed responses and reports the observation back as shared`() {
        val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":21600}}"""
        val sent = runSuspend { PermissionSyncRepository(FakeHttp { completed(200, ok) }).send(mixed) }
        assertTrue(sent is PermissionSyncResult.Sent && sent.serverTimeEpochMillis != null && sent.shared == mixed)
        assertEquals(
            PermissionSyncResult.RetryLater(12),
            runSuspend { PermissionSyncRepository(FakeHttp { completed(429, "", "12") }).send(mixed) },
        )
        assertEquals(
            PermissionSyncResult.Rejected,
            runSuspend { PermissionSyncRepository(FakeHttp { completed(400) }).send(mixed) },
        )
    }

    @Test
    fun `maps token problems`() {
        fun repo(reason: TokenUnavailable) = PermissionSyncRepository(FakeHttp { AuthedOutcome.NoToken(reason) })
        assertEquals(PermissionSyncResult.NotEnrolled, runSuspend { repo(TokenUnavailable.NotEnrolled).send(mixed) })
        assertEquals(PermissionSyncResult.Disconnected, runSuspend { repo(TokenUnavailable.Disconnected).send(mixed) })
        assertEquals(
            PermissionSyncResult.RetryLater(40),
            runSuspend { repo(TokenUnavailable.Retry(RetryReason.RateLimited, 40)).send(mixed) },
        )
        assertEquals(
            PermissionSyncResult.RetryLater(null),
            runSuspend { repo(TokenUnavailable.Retry(RetryReason.Offline)).send(mixed) },
        )
    }

    @Test
    fun `a network exception is a retry, cancellation is not swallowed`() {
        assertEquals(
            PermissionSyncResult.RetryLater(),
            runSuspend { PermissionSyncRepository(FakeHttp { throw IOException("boom") }).send(mixed) },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { PermissionSyncRepository(FakeHttp { throw CancellationException("stop") }).send(mixed) }
        }
    }
}
