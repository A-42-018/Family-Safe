package app.familysafe.child.domain

import java.time.LocalDate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceDetailsTest {
    private val today = LocalDate.parse("2026-09-30")

    @Test
    fun `patch parser accepts real dates only`() {
        assertEquals("2025-09-05", SecurityPatchParser.normalize(" 2025-09-05 "))
        for (
        bad in listOf(
            null, "", "  ", "2025-9-5", "2025-02-30", "2009-12-31", "20250905", "2025-09-05T00", "abc",
        )
        ) {
            assertNull(SecurityPatchParser.normalize(bad), bad)
        }
        assertEquals("2010-01-01", SecurityPatchParser.normalize("2010-01-01"))
    }

    @Test
    fun `bytes become MiB and untrustworthy figures become null`() {
        assertEquals(1024L, StorageMath.bytesToMb(1024L * 1_048_576L))
        assertEquals(110_000L to 50_000L, StorageMath.fromBytes(110_000L * 1_048_576L, 50_000L * 1_048_576L))
        assertNull(StorageMath.fromBytes(0, 0))
        assertNull(StorageMath.fromBytes(-5, 1))
        assertNull(StorageMath.fromBytes(10_000_000, -1))
        // Less than one MiB in total rounds to 0: not a valid total.
        assertNull(StorageMath.fromBytes(500_000, 100))
    }

    @Test
    fun `pair is all or nothing and free never exceeds total`() {
        assertEquals(10L to 0L, StorageMath.pair(10, 0))
        assertNull(StorageMath.pair(null, 5))
        assertNull(StorageMath.pair(5, null))
        assertNull(StorageMath.pair(5, 6))
        assertNull(StorageMath.pair(0, 0))
        val max = DeviceDetailsLimits.STORAGE_MB_MAX
        assertEquals(max to max, StorageMath.pair(max + 10, max + 20))
    }

    @Test
    fun `sanitized keeps good values`() {
        val clean = DeviceDetails(34, "2025-09-05", 110_000, 50_000).sanitized(today)
        assertEquals(DeviceDetails(34, "2025-09-05", 110_000, 50_000), clean)
    }

    @Test
    fun `sanitized rejects an unusable api level and degrades everything else`() {
        assertNull(DeviceDetails(0, null, null, null).sanitized(today))
        assertNull(DeviceDetails(100, null, null, null).sanitized(today))
        assertEquals(DeviceDetails(1, null, null, null), DeviceDetails(1, "junk", 5, null).sanitized(today))
        assertEquals(DeviceDetails(99, null, null, null), DeviceDetails(99, null, 5, 6).sanitized(today))
    }

    @Test
    fun `a patch date after today is dropped, today itself is kept`() {
        assertEquals("2026-09-30", DeviceDetails(34, "2026-09-30", null, null).sanitized(today)!!.securityPatch)
        assertNull(DeviceDetails(34, "2026-10-01", null, null).sanitized(today)!!.securityPatch)
    }

    @Test
    fun `toString never prints values`() {
        assertEquals("DeviceDetails", DeviceDetails(34, "2025-09-05", 1, 1).toString())
        assertEquals("DeviceInfoReport", DeviceInfoReport(DeviceDetails(34, null, null, null), 5).toString())
    }

    @Test
    fun `report codec round trips including nulls`() {
        val full = DeviceInfoReport(DeviceDetails(34, "2025-09-05", 110_000, 50_000), 1_700_000_000_000L)
        val back = DeviceInfoReportCodec.decode(DeviceInfoReportCodec.encode(full))!!
        assertEquals(full.details, back.details)
        assertEquals(full.sentAtEpochMillis, back.sentAtEpochMillis)
        val sparse = DeviceInfoReport(DeviceDetails(33, null, null, null), 9L)
        assertEquals("9;33;;;", DeviceInfoReportCodec.encode(sparse))
        assertEquals(sparse.details, DeviceInfoReportCodec.decode("9;33;;;")!!.details)
    }

    @Test
    fun `report codec rejects junk`() {
        val junk = listOf(
            null, "", "x", "1;2;3", "0;34;;;", "-1;34;;;", "5;abc;;;", "5;100;;;", "5;34;2025-02-30;;",
            "5;34;;10;", "5;34;;;10", "5;34;;10;20", "5;34;;x;y", "5;34;;10;5;extra",
        )
        for (text in junk) assertNull(DeviceInfoReportCodec.decode(text), text)
    }

    @Test
    fun `update policy compares api level and patch only`() {
        val last = DeviceInfoReport(DeviceDetails(34, "2025-09-05", 100, 50), 5)
        assertFalse(DeviceInfoPolicy.needsUploadNow(null, DeviceDetails(34, "2025-09-05", 100, 50)))
        assertFalse(DeviceInfoPolicy.needsUploadNow(last, DeviceDetails(34, "2025-09-05", 999, 1)))
        assertTrue(DeviceInfoPolicy.needsUploadNow(last, DeviceDetails(35, "2025-09-05", 100, 50)))
        assertTrue(DeviceInfoPolicy.needsUploadNow(last, DeviceDetails(34, "2025-10-05", 100, 50)))
        assertTrue(DeviceInfoPolicy.needsUploadNow(last, DeviceDetails(34, null, 100, 50)))
    }

    @Test
    fun `limits mirror the contract`() {
        assertEquals(1, DeviceDetailsLimits.SDK_MIN)
        assertEquals(99, DeviceDetailsLimits.SDK_MAX)
        assertEquals(16_777_216L, DeviceDetailsLimits.STORAGE_MB_MAX)
        assertEquals("2010-01-01", DeviceDetailsLimits.SECURITY_PATCH_MIN)
    }
}
