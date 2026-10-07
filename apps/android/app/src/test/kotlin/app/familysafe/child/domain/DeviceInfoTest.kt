package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DeviceInfoTest {
    @Test
    fun `default name joins maker and model without repeating the maker`() {
        assertEquals("Google Pixel 8", DeviceInfo.defaultName("Google", "Pixel 8"))
        assertEquals("samsung SM-S911B", DeviceInfo.defaultName("samsung", "samsung SM-S911B"))
        assertEquals("Pixel", DeviceInfo.defaultName("", "Pixel"))
        assertEquals("Acme", DeviceInfo.defaultName("Acme", null))
        assertEquals("Android device", DeviceInfo.defaultName(null, null))
        assertEquals("Android device", DeviceInfo.defaultName("  ", " "))
        assertTrue(DeviceInfo.defaultName("M".repeat(80), "X".repeat(80)).length <= DeviceInfoLimits.NAME)
    }

    @Test
    fun `sanitized trims strips control characters and clamps to the server limits`() {
        val info = DeviceInfo(
            name = "  Sam's\nphone\u0000 ",
            manufacturer = " ".repeat(3),
            model = "M".repeat(500),
            androidVersion = "14",
            appVersion = "V".repeat(99),
        ).sanitized()
        assertNotNull(info)
        assertEquals("Sam'sphone", info!!.name)
        assertNull(info.manufacturer)
        assertEquals(DeviceInfoLimits.MODEL, info.model!!.length)
        assertEquals("14", info.androidVersion)
        assertEquals(DeviceInfoLimits.APP_VERSION, info.appVersion!!.length)
    }

    @Test
    fun `blank name is unusable`() {
        assertNull(DeviceInfo("  \n ", null, null, null, null).sanitized())
    }

    @Test
    fun `clamping never leaves half a surrogate pair`() {
        val emoji = "\uD83D\uDE00" // one code point, two chars
        val cleaned = DeviceText.clean("a".repeat(99) + emoji, DeviceInfoLimits.NAME)!!
        assertEquals(99, cleaned.length)
        assertFalse(cleaned.last().isHighSurrogate())
    }
}
