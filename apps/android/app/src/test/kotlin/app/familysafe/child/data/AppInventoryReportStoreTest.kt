package app.familysafe.child.data

import app.familysafe.child.domain.AppInventory
import app.familysafe.child.domain.AppInventoryReport
import app.familysafe.child.domain.InstalledApp
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AppInventoryReportStoreTest {
    private val report = AppInventoryReport(
        AppInventory(
            listOf(InstalledApp("com.a.a", "Ay", "1.0", false), InstalledApp("com.b.b", "Bee", null, true)),
            3,
        ),
        1_700_000_000_000L,
    )

    @Test
    fun `starts empty`() {
        assertNull(AppInventoryReportStore(MapSecureStore()).report.value)
    }

    @Test
    fun `records and survives a restart`() {
        val backing = MapSecureStore()
        AppInventoryReportStore(backing).record(report)
        val reopened = AppInventoryReportStore(backing).report.value!!
        assertEquals(report.inventory, reopened.inventory)
        assertEquals(report.sentAtEpochMillis, reopened.sentAtEpochMillis)
    }

    @Test
    fun `writes one key only so a restart cannot see half a report`() {
        val backing = MapSecureStore()
        AppInventoryReportStore(backing).record(report)
        assertEquals(listOf("app_inventory_report"), backing.putKeys)
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = AppInventoryReportStore(backing)
        store.record(report)
        store.clear()
        assertNull(store.report.value)
        assertNull(AppInventoryReportStore(backing).report.value)
    }

    @Test
    fun `junk or tampered storage reads as nothing sent`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "v1;5;0;com.b;x;;0", "v9\u001f5\u001f0")) {
            backing.map["app_inventory_report"] = junk
            assertNull(AppInventoryReportStore(backing).report.value, junk)
        }
    }

    @Test
    fun `a failing read or write never crashes the screen`() {
        val unreadable = MapSecureStore().apply { failGet = true }
        assertNull(AppInventoryReportStore(unreadable).report.value)
        val unwritable = MapSecureStore().apply { failPut = { true } }
        val store = AppInventoryReportStore(unwritable)
        store.record(report)
        assertEquals(report.inventory, store.report.value!!.inventory)
    }
}
