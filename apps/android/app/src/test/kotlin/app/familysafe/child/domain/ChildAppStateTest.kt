package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ChildAppStateTest {
    @Test
    fun `default state is not enrolled and shares nothing`() {
        val state = ChildAppState()
        assertEquals(EnrollmentState.NotEnrolled, state.enrollment)
        assertFalse(state.isEnrolled)
        assertFalse(state.sharesAnything)
    }

    @Test
    fun `enrolled state is enrolled and never prints the device id`() {
        val enrollment = EnrollmentState.Enrolled("2b0c1c48-1c7e-4c57-9d0f-5f3c3d0a9a11")
        val state = ChildAppState(enrollment = enrollment)
        assertTrue(state.isEnrolled)
        assertFalse(enrollment.toString().contains("2b0c"))
        assertFalse(state.toString().contains("2b0c"))
    }

    @Test
    fun `sync status has never happened by default`() {
        assertFalse(SyncStatus().hasSynced)
        assertTrue(SyncStatus(1L).hasSynced)
    }

    @Test
    fun `every permission starts not requested`() {
        val entries = PermissionCatalog.initial()
        assertEquals(PermissionKey.entries.toSet(), entries.map { it.key }.toSet())
        assertTrue(entries.all { it.state == PermissionState.NOT_REQUESTED })
    }

    @Test
    fun `permission states match the database check list`() {
        assertEquals(
            setOf("GRANTED", "DENIED", "REVOKED", "RESTRICTED", "NOT_AVAILABLE", "NOT_REQUESTED"),
            PermissionState.entries.map { it.name }.toSet(),
        )
    }

    @Test
    fun `disconnected means not enrolled with a lost connection, never an enrolled device`() {
        assertTrue(ChildAppState(auth = DeviceAuthState.Revoked).isDisconnected)
        assertTrue(ChildAppState(auth = DeviceAuthState.Expired).isDisconnected)
        assertTrue(ChildAppState(auth = DeviceAuthState.Uncertain).isDisconnected)
        assertFalse(ChildAppState(auth = DeviceAuthState.Unknown).isDisconnected)
        assertFalse(ChildAppState(auth = DeviceAuthState.Connected).isDisconnected)
        val enrolled = ChildAppState(EnrollmentState.Enrolled("id"), DeviceAuthState.Revoked)
        assertFalse(enrolled.isDisconnected)
    }

    @Test
    fun `no limit has been checked by default`() {
        assertEquals(LimitStatus.Unchecked, ChildAppState().limit)
    }
}
