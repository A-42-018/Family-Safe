package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HeartbeatPolicyTest {
    private val enrolled = EnrollmentState.Enrolled("11111111-2222-3333-4444-555555555555")

    @Test
    fun `runs while enrolled with unknown or connected auth`() {
        assertTrue(HeartbeatPolicy.shouldRun(ChildAppState(enrollment = enrolled, auth = DeviceAuthState.Unknown)))
        assertTrue(HeartbeatPolicy.shouldRun(ChildAppState(enrollment = enrolled, auth = DeviceAuthState.Connected)))
    }

    @Test
    fun `does not run when not enrolled`() {
        assertFalse(HeartbeatPolicy.shouldRun(ChildAppState()))
    }

    @Test
    fun `does not run once disconnected, even if enrollment still reads as present`() {
        for (auth in listOf(DeviceAuthState.Revoked, DeviceAuthState.Expired, DeviceAuthState.Uncertain)) {
            assertFalse(HeartbeatPolicy.shouldRun(ChildAppState(enrollment = enrolled, auth = auth)))
            assertFalse(HeartbeatPolicy.shouldRun(ChildAppState(auth = auth)))
        }
    }
}
