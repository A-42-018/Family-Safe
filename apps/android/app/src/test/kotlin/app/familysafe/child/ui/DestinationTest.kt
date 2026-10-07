package app.familysafe.child.ui

import app.familysafe.child.ui.navigation.Destination
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DestinationTest {
    @Test
    fun `there are exactly the six screens from the spec`() {
        assertEquals(
            setOf("device-status", "permissions", "enrollment", "sync-status", "safety", "about"),
            Destination.entries.map { it.route }.toSet(),
        )
    }

    @Test
    fun `routes are unique and resolve back`() {
        assertEquals(Destination.entries.size, Destination.entries.map { it.route }.distinct().size)
        Destination.entries.forEach { assertEquals(it, Destination.fromRoute(it.route)) }
        assertNull(Destination.fromRoute("unknown"))
        assertNull(Destination.fromRoute(null))
    }

    @Test
    fun `start is device status and is not in the secondary list`() {
        assertEquals(Destination.DeviceStatus, Destination.start)
        assertFalse(Destination.start in Destination.secondary)
        assertEquals(5, Destination.secondary.size)
    }
}
