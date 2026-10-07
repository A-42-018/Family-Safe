package app.familysafe.child.data

import app.familysafe.child.domain.LimitReportState
import app.familysafe.child.domain.PendingLimitReport
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LimitReportStoreTest {
    private val pending = LimitReportState("2026-10-04", PendingLimitReport("2026-10-05", 1_790_000_000_000L))

    @Test
    fun `starts empty`() {
        assertEquals(LimitReportState(), LimitReportStore(MapSecureStore()).snapshot())
    }

    @Test
    fun `survives a restart`() {
        val backing = MapSecureStore()
        LimitReportStore(backing).update { pending }
        assertEquals(pending, LimitReportStore(backing).snapshot())
    }

    @Test
    fun `an unchanged state is not written again`() {
        val backing = MapSecureStore()
        val store = LimitReportStore(backing)
        store.update { pending }
        val writes = backing.putKeys.size
        store.update { it }
        store.update { LimitReportState(it.lastReportedDay, it.pending) }
        assertEquals(writes, backing.putKeys.size)
    }

    @Test
    fun `junk or tampered storage reads as empty`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "v1;x;;", "v1;;2026-10-05;")) {
            backing.map["limit_report"] = junk
            assertEquals(LimitReportState(), LimitReportStore(backing).snapshot(), junk)
        }
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = LimitReportStore(backing)
        store.update { pending }
        store.clear()
        assertEquals(LimitReportState(), store.snapshot())
        assertNull(backing.map["limit_report"])
        assertEquals(LimitReportState(), LimitReportStore(backing).snapshot())
    }

    @Test
    fun `broken storage never throws and still reports this process's value`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = LimitReportStore(backing)
        assertEquals(LimitReportState(), store.snapshot())
        store.update { pending }
        assertEquals(pending, store.snapshot())
        store.clear()
        assertTrue(store.snapshot().pending == null)
    }
}
