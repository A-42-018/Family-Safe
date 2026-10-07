package app.familysafe.child.ui.enrollment

import app.cash.turbine.test
import app.familysafe.child.data.CredentialStore
import app.familysafe.child.data.EnrollmentApi
import app.familysafe.child.data.EnrollmentRepository
import app.familysafe.child.data.RedeemOutcome
import app.familysafe.child.data.RedeemRequest
import app.familysafe.child.data.RedeemResponse
import app.familysafe.child.domain.DeviceInfo
import app.familysafe.child.domain.EnrollmentFailure
import app.familysafe.child.testutil.MapSecureStore
import app.familysafe.child.testutil.VALID_CODE
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EnrollmentViewModelTest {
    private class Api(var next: RedeemOutcome) : EnrollmentApi {
        var calls = 0
        override suspend fun redeem(request: RedeemRequest): RedeemOutcome {
            calls++
            return next
        }
    }

    private val info = DeviceInfo("Pixel 8", "Google", "Pixel 8", "14", "0.10.0")
    private val ok = RedeemOutcome.Success(
        RedeemResponse("11111111-2222-3333-4444-555555555555", "R".repeat(43), 1_900_000_000_000L),
    )

    @Test
    fun `successful connect goes submitting then done, clears the code and notifies`() = runTest {
        val api = Api(ok)
        var enrolledCalls = 0
        val vm = EnrollmentViewModel(
            EnrollmentRepository(api, CredentialStore(MapSecureStore())),
            { info },
            this,
        ) { enrolledCalls++ }

        vm.state.test {
            assertEquals("Pixel 8", awaitItem().deviceName)
            vm.onCodeChange(VALID_CODE)
            assertTrue(awaitItem().canSubmit)
            vm.onConnect()
            assertTrue(awaitItem().submitting)
            val done = awaitItem()
            assertFalse(done.submitting)
            assertEquals("", done.codeText)
            assertEquals(1, enrolledCalls)
            cancelAndIgnoreRemainingEvents()
        }
        assertEquals(1, api.calls)
    }

    @Test
    fun `incomplete form shows a validation error and makes no call`() = runTest {
        val api = Api(ok)
        val vm = EnrollmentViewModel(EnrollmentRepository(api, CredentialStore(MapSecureStore())), { info }, this) {}
        vm.onCodeChange("0123")
        vm.onConnect()
        assertEquals(EnrollmentFailure.InvalidFormat, vm.state.value.failure)
        assertEquals(0, api.calls)
    }

    @Test
    fun `failure keeps a reusable code and does not notify`() = runTest {
        val api = Api(RedeemOutcome.Failure(EnrollmentFailure.Unreachable))
        var enrolledCalls = 0
        val vm = EnrollmentViewModel(
            EnrollmentRepository(api, CredentialStore(MapSecureStore())),
            { info },
            this,
        ) { enrolledCalls++ }
        vm.onCodeChange(VALID_CODE)
        vm.onConnect()
        testScheduler.advanceUntilIdle()
        assertEquals(EnrollmentFailure.Unreachable, vm.state.value.failure)
        assertEquals("0123-4567-89AB-CDEF", vm.state.value.codeText)
        assertEquals(0, enrolledCalls)
    }
}
