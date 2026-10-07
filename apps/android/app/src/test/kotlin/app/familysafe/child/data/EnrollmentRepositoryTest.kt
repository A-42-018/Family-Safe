package app.familysafe.child.data

import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.domain.EnrollmentFailure
import app.familysafe.child.domain.EnrollmentResult
import app.familysafe.child.domain.EnrollmentState
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.VALID_CODE
import app.familysafe.child.testutil.VALID_CODE_TYPED
import app.familysafe.child.testutil.runSuspend
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private const val DEVICE_ID = "11111111-2222-3333-4444-555555555555"
private val TOKEN = "R".repeat(43)

private fun success() = RedeemOutcome.Success(RedeemResponse(DEVICE_ID, TOKEN, 1_900_000_000_000L))

private class FakeApi(var next: RedeemOutcome = success()) : EnrollmentApi {
    val requests = mutableListOf<RedeemRequest>()
    var onCall: (suspend () -> Unit)? = null

    override suspend fun redeem(request: RedeemRequest): RedeemOutcome {
        requests += request
        onCall?.invoke()
        return next
    }
}

class EnrollmentRepositoryTest {
    private val backing = MapSecureStore()
    private val api = FakeApi()
    private val repo = EnrollmentRepository(api, CredentialStore(backing))
    private val device = DeviceInfo("  Sam's phone ", "Google", "Pixel 8", "14", "0.10.0")

    private fun enroll(code: String = VALID_CODE_TYPED, info: DeviceInfo = device) =
        runSuspend { repo.enroll(code, info) }

    private fun failure(result: EnrollmentResult) = (result as EnrollmentResult.Failed).failure

    @Test
    fun `success stores credentials and reports enrolled`() {
        val result = enroll()
        assertEquals(EnrollmentResult.Enrolled(EnrollmentState.Enrolled(DEVICE_ID)), result)
        assertEquals(EnrollmentState.Enrolled(DEVICE_ID), repo.currentState())
        assertEquals(TOKEN, CredentialStore(backing).load()!!.refreshToken)
    }

    @Test
    fun `request carries the normalized code and sanitized device fields`() {
        enroll()
        val request = api.requests.single()
        assertEquals(VALID_CODE, request.code)
        assertEquals("Sam's phone", request.deviceName)
        assertEquals("Google", request.manufacturer)
        assertEquals("Pixel 8", request.model)
        assertEquals("14", request.androidVersion)
        assertEquals("0.10.0", request.appVersion)
    }

    @Test
    fun `a pasted QR payload is accepted`() {
        enroll("familysafe://enroll?c=$VALID_CODE")
        assertEquals(VALID_CODE, api.requests.single().code)
    }

    @Test
    fun `malformed code never reaches the network`() {
        listOf("", "1234", "0123-4567-89ab-cdeU", "x".repeat(200)).forEach {
            assertEquals(EnrollmentFailure.InvalidFormat, failure(enroll(it)))
        }
        assertTrue(api.requests.isEmpty())
        assertTrue(backing.map.isEmpty())
    }

    @Test
    fun `blank device name never reaches the network`() {
        assertEquals(EnrollmentFailure.InvalidDeviceName, failure(enroll(info = device.copy(name = "  "))))
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun `every server or network failure is passed through and stores nothing`() {
        listOf(
            EnrollmentFailure.InvalidCode,
            EnrollmentFailure.RateLimited(30),
            EnrollmentFailure.Unreachable,
            EnrollmentFailure.Uncertain,
            EnrollmentFailure.ServerError,
            EnrollmentFailure.Rejected,
        ).forEach { expected ->
            api.next = RedeemOutcome.Failure(expected)
            assertEquals(expected, failure(enroll()))
            assertEquals(EnrollmentState.NotEnrolled, repo.currentState())
            assertTrue(backing.map.isEmpty())
        }
    }

    @Test
    fun `secure storage that cannot be written is detected before the code is spent`() {
        backing.failPut = { true }
        assertEquals(EnrollmentFailure.StorageUnavailable, failure(enroll()))
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun `storage failing after the server accepted the code is reported and cleaned up`() {
        backing.failPut = { it == "device_id" }
        assertEquals(EnrollmentFailure.StorageFailed, failure(enroll()))
        assertEquals(1, api.requests.size)
        assertTrue(backing.map.isEmpty())
        assertTrue(EnrollmentFailure.StorageFailed.codeIsSpent)
    }

    @Test
    fun `an enrolled device does not enroll again`() {
        enroll()
        api.requests.clear()
        assertEquals(EnrollmentFailure.AlreadyEnrolled, failure(enroll()))
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun `a second enroll while one is running is refused and the guard is released afterwards`() {
        var inner: EnrollmentResult? = null
        api.onCall = { inner = repo.enroll(VALID_CODE, device) }
        val outer = enroll()
        assertInstanceOf(EnrollmentResult.Enrolled::class.java, outer)
        assertEquals(EnrollmentFailure.Busy, failure(inner!!))
        assertEquals(1, api.requests.size)
        assertEquals(EnrollmentFailure.AlreadyEnrolled, failure(enroll())) // guard released, normal path again
    }

    @Test
    fun `unreadable storage reads as not enrolled`() {
        backing.failGet = true
        assertEquals(EnrollmentState.NotEnrolled, repo.currentState())
        assertEquals(EnrollmentFailure.StorageUnavailable, failure(enroll()))
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun `secrets are never printed`() {
        enroll()
        val request = api.requests.single()
        val printed = listOf(request.toString(), success().toString(), success().response.toString())
        printed.forEach {
            assertFalse(it.contains(VALID_CODE))
            assertFalse(it.contains(TOKEN))
            assertFalse(it.contains(DEVICE_ID))
        }
        assertNull(null)
    }
}
