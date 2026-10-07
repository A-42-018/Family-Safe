package app.familysafe.child.data

import app.familysafe.child.domain.PermissionKey
import app.familysafe.child.domain.PermissionProbe
import app.familysafe.child.domain.PermissionState
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PermissionStateReaderTest {
    private class FakeProbe : PermissionProbe {
        val unavailable = mutableSetOf<PermissionKey>()
        val granted = mutableSetOf<PermissionKey>()
        var failOn: PermissionKey? = null

        override fun isAvailable(key: PermissionKey): Boolean = key !in unavailable

        override fun isGranted(key: PermissionKey): Boolean {
            if (key == failOn) error("probe failed")
            return key in granted
        }
    }

    private val probe = FakeProbe()
    private val history = PermissionHistoryStore(MapSecureStore())
    private val reader = PermissionStateReader(probe, history)

    @Test
    fun `nothing granted and nothing asked reads as not requested everywhere`() {
        val states = reader.read().states
        assertEquals(8, states.size)
        assertEquals(setOf(PermissionState.NOT_REQUESTED), states.values.toSet())
    }

    @Test
    fun `unavailable permissions read as not available and are never asked about`() {
        probe.unavailable += listOf(PermissionKey.SMS, PermissionKey.CALL_LOG)
        probe.granted += PermissionKey.SMS
        val states = reader.read().states
        assertEquals(PermissionState.NOT_AVAILABLE, states.getValue(PermissionKey.SMS))
        assertEquals(PermissionState.NOT_AVAILABLE, states.getValue(PermissionKey.CALL_LOG))
    }

    @Test
    fun `a grant is seen, and later turning it off reads as revoked`() {
        probe.granted += PermissionKey.CAMERA
        assertEquals(PermissionState.GRANTED, reader.read().states.getValue(PermissionKey.CAMERA))
        probe.granted -= PermissionKey.CAMERA
        assertEquals(PermissionState.REVOKED, reader.read().states.getValue(PermissionKey.CAMERA))
        probe.granted += PermissionKey.CAMERA
        assertEquals(PermissionState.GRANTED, reader.read().states.getValue(PermissionKey.CAMERA))
    }

    @Test
    fun `a permission the app asked for and the child refused reads as denied`() {
        history.markRequested(PermissionKey.MICROPHONE)
        assertEquals(PermissionState.DENIED, reader.read().states.getValue(PermissionKey.MICROPHONE))
        assertEquals(PermissionState.NOT_REQUESTED, reader.read().states.getValue(PermissionKey.CAMERA))
    }

    @Test
    fun `location variants are read independently`() {
        probe.granted += PermissionKey.LOCATION
        val states = reader.read().states
        assertEquals(PermissionState.GRANTED, states.getValue(PermissionKey.LOCATION))
        assertEquals(PermissionState.NOT_REQUESTED, states.getValue(PermissionKey.PRECISE_LOCATION))
        assertEquals(PermissionState.NOT_REQUESTED, states.getValue(PermissionKey.BACKGROUND_LOCATION))
    }

    @Test
    fun `a failing probe fails the whole reading instead of guessing`() {
        probe.failOn = PermissionKey.CONTACTS
        assertThrows(IllegalStateException::class.java) { reader.read() }
    }
}
