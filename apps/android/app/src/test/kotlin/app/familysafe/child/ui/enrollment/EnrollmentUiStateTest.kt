package app.familysafe.child.ui.enrollment

import app.familysafe.child.domain.EnrollmentFailure
import app.familysafe.child.domain.EnrollmentResult
import app.familysafe.child.domain.EnrollmentState
import app.familysafe.child.testutil.VALID_CODE
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class EnrollmentUiStateTest {
    private val empty = EnrollmentUiState(deviceName = "Pixel")
    private val ready = empty.withCodeInput(VALID_CODE)

    @Test
    fun `typing formats the code live`() {
        assertEquals("0123-4567-89AB-CDEF", empty.withCodeInput("0123456789abcdef").codeText)
        assertEquals("0123-4", empty.withCodeInput("0123 4").codeText)
        assertEquals("0123", empty.withCodeInput("0123-").codeText) // backspacing over a hyphen never sticks
    }

    @Test
    fun `a pasted QR payload is unwrapped`() {
        assertEquals("0123-4567-89AB-CDEF", empty.withCodeInput("familysafe://enroll?c=$VALID_CODE").codeText)
    }

    @Test
    fun `can submit only with a complete code and a name and not while submitting`() {
        assertFalse(empty.canSubmit)
        assertFalse(empty.withCodeInput("0123-4567").canSubmit)
        assertTrue(ready.canSubmit)
        assertFalse(ready.withDeviceName("   ").canSubmit)
        assertFalse(ready.submitting().canSubmit)
    }

    @Test
    fun `device name is length limited and stripped of control characters`() {
        assertEquals(100, empty.withDeviceName("x".repeat(500)).deviceName.length)
        assertEquals("ab", empty.withDeviceName("a\nb").deviceName)
    }

    @Test
    fun `editing clears the previous error`() {
        val failed = ready.finished(EnrollmentResult.Failed(EnrollmentFailure.Unreachable))
        assertEquals(EnrollmentFailure.Unreachable, failed.failure)
        assertNull(failed.withCodeInput(VALID_CODE).failure)
        assertNull(failed.withDeviceName("New").failure)
    }

    @Test
    fun `validation failure names the first problem`() {
        assertEquals(EnrollmentFailure.InvalidFormat, empty.validationFailure())
        assertEquals(EnrollmentFailure.InvalidDeviceName, ready.withDeviceName("").validationFailure())
        assertNull(ready.validationFailure())
    }

    @Test
    fun `success clears the code`() {
        val done = ready.submitting().finished(EnrollmentResult.Enrolled(EnrollmentState.Enrolled("id")))
        assertEquals("", done.codeText)
        assertFalse(done.submitting)
        assertNull(done.failure)
    }

    @Test
    fun `a spent code is cleared and a reusable one is kept`() {
        listOf(EnrollmentFailure.InvalidCode, EnrollmentFailure.Uncertain, EnrollmentFailure.StorageFailed).forEach {
            assertEquals("", ready.submitting().finished(EnrollmentResult.Failed(it)).codeText, "$it")
        }
        listOf(
            EnrollmentFailure.Unreachable,
            EnrollmentFailure.RateLimited(10),
            EnrollmentFailure.ServerError,
            EnrollmentFailure.Rejected,
            EnrollmentFailure.StorageUnavailable,
            EnrollmentFailure.Busy,
        ).forEach {
            val after = ready.submitting().finished(EnrollmentResult.Failed(it))
            assertEquals(ready.codeText, after.codeText, "$it")
            assertFalse(after.submitting)
            assertEquals(it, after.failure)
        }
    }

    @Test
    fun `parent revoke hint only where the device may exist on the server`() {
        assertTrue(EnrollmentFailure.Uncertain.mayNeedParentRevoke)
        assertTrue(EnrollmentFailure.StorageFailed.mayNeedParentRevoke)
        assertTrue(EnrollmentFailure.ServerError.mayNeedParentRevoke)
        assertFalse(EnrollmentFailure.InvalidCode.mayNeedParentRevoke)
        assertFalse(EnrollmentFailure.Unreachable.mayNeedParentRevoke)
    }

    @Test
    fun `the code is never printed`() {
        assertFalse(ready.toString().contains("0123"))
    }
}
