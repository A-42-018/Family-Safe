package app.familysafe.child.data

import app.familysafe.child.domain.DeviceDetails
import app.familysafe.child.domain.DeviceInfoReport
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DeviceInfoReportStoreTest {
    private val report = DeviceInfoReport(DeviceDetails(34, "2025-09-05", 110_000, 50_000), 1_700_000_000_000L)

    @Test
    fun `starts empty`() {
        assertNull(DeviceInfoReportStore(MapSecureStore()).report.value)
    }

    @Test
    fun `records and survives a restart`() {
        val backing = MapSecureStore()
        DeviceInfoReportStore(backing).record(report)
        val reopened = DeviceInfoReportStore(backing).report.value!!
        assertEquals(report.details, reopened.details)
        assertEquals(report.sentAtEpochMillis, reopened.sentAtEpochMillis)
    }

    @Test
    fun `writes one key only so a restart cannot see half a report`() {
        val backing = MapSecureStore()
        DeviceInfoReportStore(backing).record(report)
        assertEquals(listOf("device_info_report"), backing.putKeys)
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = DeviceInfoReportStore(backing)
        store.record(report)
        store.clear()
        assertNull(store.report.value)
        assertNull(DeviceInfoReportStore(backing).report.value)
    }

    @Test
    fun `junk or tampered storage reads as nothing sent`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "5;100;;;", "5;34;2099-13-01;;", "5;34;;10;20")) {
            backing.map["device_info_report"] = junk
            assertNull(DeviceInfoReportStore(backing).report.value, junk)
        }
    }

    @Test
    fun `broken storage never throws and still reports this process's value`() {
        val backing = MapSecureStore().apply {
            failGet = true
            failPut = { true }
        }
        val store = DeviceInfoReportStore(backing)
        assertNull(store.report.value)
        store.record(report)
        assertEquals(report.details, store.report.value!!.details)
        store.clear()
        assertNull(store.report.value)
    }
}
