package app.familysafe.child.data

import app.familysafe.child.domain.UsageAccess
import app.familysafe.child.domain.UsageAccessProbe
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class UsageAccessStoreTest {
    private var reading = UsageAccess.NOT_GRANTED
    private var failing = false

    private val probe = UsageAccessProbe {
        if (failing) throw IllegalStateException("no app ops")
        reading
    }

    @Test
    fun `starts unknown until the OS is asked`() {
        assertEquals(UsageAccess.UNKNOWN, UsageAccessStore(probe).state.value)
    }

    @Test
    fun `refresh publishes what the OS says, both ways`() {
        val store = UsageAccessStore(probe)
        assertEquals(UsageAccess.NOT_GRANTED, store.refresh())
        assertEquals(UsageAccess.NOT_GRANTED, store.state.value)
        reading = UsageAccess.GRANTED
        assertEquals(UsageAccess.GRANTED, store.refresh())
        assertEquals(UsageAccess.GRANTED, store.state.value)
        reading = UsageAccess.NOT_GRANTED
        store.refresh()
        assertEquals(UsageAccess.NOT_GRANTED, store.state.value)
    }

    @Test
    fun `a failing probe reads as unknown, never as granted`() {
        val store = UsageAccessStore(probe)
        reading = UsageAccess.GRANTED
        store.refresh()
        failing = true
        assertEquals(UsageAccess.UNKNOWN, store.refresh())
        assertEquals(UsageAccess.UNKNOWN, store.state.value)
    }
}
