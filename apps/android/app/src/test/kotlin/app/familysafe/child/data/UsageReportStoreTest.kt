package app.familysafe.child.data

import app.familysafe.child.domain.AppUsageEntry
import app.familysafe.child.domain.DayUsage
import app.familysafe.child.domain.UsageReport
import app.familysafe.child.testutil.MapSecureStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class UsageReportStoreTest {
    private val report = UsageReport(
        DayUsage(
            "2026-10-01",
            125,
            7,
            listOf(AppUsageEntry("com.a.a", 60, 3), AppUsageEntry("com.b.b", 10, 1)),
            omittedCount = 2,
        ),
        1_700_000_000_000L,
    )

    @Test
    fun `starts empty`() {
        assertNull(UsageReportStore(MapSecureStore()).report.value)
    }

    @Test
    fun `records and survives a restart`() {
        val backing = MapSecureStore()
        UsageReportStore(backing).record(report)
        val reopened = UsageReportStore(backing).report.value!!
        assertEquals(report.usage, reopened.usage)
        assertEquals(report.sentAtEpochMillis, reopened.sentAtEpochMillis)
    }

    @Test
    fun `writes one key only so a restart cannot see half a report`() {
        val backing = MapSecureStore()
        UsageReportStore(backing).record(report)
        assertEquals(listOf("usage_report"), backing.putKeys)
    }

    @Test
    fun `clear forgets it in memory and in storage`() {
        val backing = MapSecureStore()
        val store = UsageReportStore(backing)
        store.record(report)
        store.clear()
        assertNull(store.report.value)
        assertNull(UsageReportStore(backing).report.value)
    }

    @Test
    fun `junk or tampered storage reads as nothing sent`() {
        val backing = MapSecureStore()
        for (junk in listOf("yesterday", "v1;5;2026-10-01;0;0;0", "v9\u001f5\u001f0")) {
            backing.map["usage_report"] = junk
            assertNull(UsageReportStore(backing).report.value, junk)
        }
    }

    @Test
    fun `an unreadable store reads as nothing sent`() {
        val backing = MapSecureStore()
        UsageReportStore(backing).record(report)
        backing.failGet = true
        assertNull(UsageReportStore(backing).report.value)
    }

    @Test
    fun `a failing write still keeps the value for this process`() {
        val backing = MapSecureStore().apply { failPut = { true } }
        val store = UsageReportStore(backing)
        store.record(report)
        assertEquals(report.usage, store.report.value!!.usage)
        assertNull(UsageReportStore(MapSecureStore()).report.value)
    }
}
