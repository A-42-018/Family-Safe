package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.testutil.runSuspend
import java.io.IOException
import java.time.LocalDate
import kotlin.coroutines.cancellation.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceInfoRepositoryTest {
    private val managedFalse = ""","managed_mode":false}"""
    private val managedTrue = ""","managed_mode":true}"""

    private class FakeHttp(var next: () -> AuthedOutcome) : DeviceHttp {
        val calls = mutableListOf<Pair<String, String>>()

        override suspend fun postJson(endpoint: String, jsonBody: String): AuthedOutcome {
            calls += endpoint to jsonBody
            return next()
        }
    }

    private val today = LocalDate.parse("2026-09-30")
    private val details = DeviceDetails(34, "2025-09-05", 110_000, 50_000)
    private fun repo(http: DeviceHttp) = DeviceInfoRepository(http) { today }
    private fun completed(status: Int, body: String = "", retryAfter: String? = null) =
        AuthedOutcome.Completed(RawResponse(status, body, retryAfter))

    @Test
    fun `posts exactly the five contract fields to device-info`() {
        val http = FakeHttp { completed(200) }
        runSuspend { repo(http).send(details) }
        val (endpoint, body) = http.calls.single()
        assertEquals("device-info", endpoint)
        assertEquals(
            """{"sdk_level":34,"security_patch":"2025-09-05",""" +
                """"storage_total_mb":110000,"storage_free_mb":50000""" + managedFalse,
            body,
        )
    }

    @Test
    fun `managed mode goes on the wire as a boolean`() {
        val http = FakeHttp { completed(200) }
        runSuspend { repo(http).send(DeviceDetails(34, null, null, null, managedMode = true)) }
        assertEquals(
            """{"sdk_level":34,"security_patch":null,"storage_total_mb":null,"storage_free_mb":null""" + managedTrue,
            http.calls.single().second,
        )
    }

    @Test
    fun `unknown values are sent as explicit nulls because every key is required`() {
        val http = FakeHttp { completed(200) }
        runSuspend { repo(http).send(DeviceDetails(30, null, null, null)) }
        assertEquals(
            """{"sdk_level":30,"security_patch":null,"storage_total_mb":null,"storage_free_mb":null""" + managedFalse,
            http.calls.single().second,
        )
    }

    @Test
    fun `the body never names a device or an identifier`() {
        val http = FakeHttp { completed(200) }
        runSuspend { repo(http).send(details) }
        val body = http.calls.single().second
        for (word in listOf("device", "serial", "imei", "android_id", "advertising")) {
            assertFalse(body.contains(word, ignoreCase = true), word)
        }
    }

    @Test
    fun `sends the sanitized values and reports them back as shared`() {
        val http = FakeHttp { completed(200) }
        val result = runSuspend { repo(http).send(DeviceDetails(34, "2026-12-01", 10, 20)) }
        // A future patch date and an impossible storage pair both degrade to null.
        assertEquals(
            """{"sdk_level":34,"security_patch":null,"storage_total_mb":null,"storage_free_mb":null""" + managedFalse,
            http.calls.single().second,
        )
        assertEquals(DeviceDetails(34, null, null, null), (result as DeviceInfoResult.Sent).shared)
    }

    @Test
    fun `an unusable api level is rejected without any request`() {
        val http = FakeHttp { completed(200) }
        assertEquals(DeviceInfoResult.Rejected, runSuspend { repo(http).send(DeviceDetails(0, null, null, null)) })
        assertTrue(http.calls.isEmpty())
    }

    @Test
    fun `maps completed responses`() {
        val ok = """{"data":{"server_time":"2026-10-01T09:30:00.000Z","next_interval_seconds":86400}}"""
        val sent = runSuspend { repo(FakeHttp { completed(200, ok) }).send(details) }
        assertTrue(sent is DeviceInfoResult.Sent && sent.serverTimeEpochMillis != null)
        assertEquals(
            DeviceInfoResult.RetryLater(12),
            runSuspend { repo(FakeHttp { completed(429, "", "12") }).send(details) },
        )
        assertEquals(
            DeviceInfoResult.Rejected,
            runSuspend { repo(FakeHttp { completed(400) }).send(details) },
        )
    }

    @Test
    fun `maps token problems`() {
        fun noToken(reason: TokenUnavailable) = FakeHttp { AuthedOutcome.NoToken(reason) }
        assertEquals(
            DeviceInfoResult.NotEnrolled,
            runSuspend { repo(noToken(TokenUnavailable.NotEnrolled)).send(details) },
        )
        assertEquals(
            DeviceInfoResult.Disconnected,
            runSuspend { repo(noToken(TokenUnavailable.Disconnected)).send(details) },
        )
        assertEquals(
            DeviceInfoResult.RetryLater(40),
            runSuspend { repo(noToken(TokenUnavailable.Retry(RetryReason.RateLimited, 40))).send(details) },
        )
        assertEquals(
            DeviceInfoResult.RetryLater(null),
            runSuspend { repo(noToken(TokenUnavailable.Retry(RetryReason.Offline))).send(details) },
        )
    }

    @Test
    fun `a network exception is a retry, cancellation is not swallowed`() {
        assertEquals(
            DeviceInfoResult.RetryLater(),
            runSuspend { repo(FakeHttp { throw IOException("boom") }).send(details) },
        )
        assertThrows(CancellationException::class.java) {
            runSuspend { repo(FakeHttp { throw CancellationException("stop") }).send(details) }
        }
    }
}
