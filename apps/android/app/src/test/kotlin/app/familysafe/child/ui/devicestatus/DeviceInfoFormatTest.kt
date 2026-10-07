package app.familysafe.child.ui.devicestatus

import java.util.Locale
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DeviceInfoFormatTest {
    @Test
    fun `gigabytes uses one decimal in the given locale`() {
        assertEquals("1.0", DeviceInfoFormat.gigabytes(1024, Locale.ROOT))
        assertEquals("12.3", DeviceInfoFormat.gigabytes(12_595, Locale.ROOT))
        assertEquals("0.0", DeviceInfoFormat.gigabytes(0, Locale.ROOT))
        assertEquals("1,5", DeviceInfoFormat.gigabytes(1536, Locale.GERMANY))
    }

    @Test
    fun `used percent needs a valid pair`() {
        assertEquals(50, DeviceInfoFormat.usedPercent(100, 50))
        assertEquals(0, DeviceInfoFormat.usedPercent(100, 100))
        assertEquals(100, DeviceInfoFormat.usedPercent(100, 0))
        assertNull(DeviceInfoFormat.usedPercent(null, 5))
        assertNull(DeviceInfoFormat.usedPercent(5, null))
        assertNull(DeviceInfoFormat.usedPercent(0, 0))
        assertNull(DeviceInfoFormat.usedPercent(10, 11))
        assertNull(DeviceInfoFormat.usedPercent(10, -1))
    }
}
