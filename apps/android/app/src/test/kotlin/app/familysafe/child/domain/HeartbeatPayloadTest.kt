package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class HeartbeatPayloadTest {
    private fun payload(app: String = "0.12.0", android: String = "14", battery: Int = 80) =
        HeartbeatPayload(app, android, battery, isCharging = true, networkType = NetworkType.Wifi)

    @Test
    fun `sanitized trims strips control characters and clamps the battery`() {
        val clean = payload(app = "  0.12.0\n", android = "1\u00004 ", battery = 140).sanitized()!!
        assertEquals("0.12.0", clean.appVersion)
        assertEquals("14", clean.androidVersion)
        assertEquals(100, clean.batteryLevel)
        assertEquals(0, payload(battery = -5).sanitized()!!.batteryLevel)
    }

    @Test
    fun `sanitized caps versions at the server limit`() {
        val clean = payload(app = "v".repeat(80)).sanitized()!!
        assertEquals(HeartbeatLimits.VERSION_MAX, clean.appVersion.length)
    }

    @Test
    fun `an empty version is unusable`() {
        assertNull(payload(app = "  ").sanitized())
        assertNull(payload(android = "").sanitized())
    }

    @Test
    fun `toString reveals nothing`() {
        assertEquals("HeartbeatPayload", payload().toString())
    }

    @Test
    fun `battery percent handles normal, odd scales and missing readings`() {
        assertEquals(50, BatteryMath.percent(50, 100))
        assertEquals(50, BatteryMath.percent(127, 254))
        assertEquals(100, BatteryMath.percent(300, 100))
        assertEquals(0, BatteryMath.percent(0, 100))
        assertNull(BatteryMath.percent(-1, 100))
        assertNull(BatteryMath.percent(50, -1))
        assertNull(BatteryMath.percent(50, 0))
    }

    @Test
    fun `charging means charging, or full while plugged in`() {
        assertTrue(BatteryMath.isCharging(status = 2, plugged = 1))
        assertTrue(BatteryMath.isCharging(status = 5, plugged = 2))
        assertFalse(BatteryMath.isCharging(status = 5, plugged = 0))
        assertFalse(BatteryMath.isCharging(status = 3, plugged = 0)) // discharging
        assertFalse(BatteryMath.isCharging(status = -1, plugged = 0))
    }

    @Test
    fun `network mapping prefers vpn, then wifi, cellular, ethernet`() {
        fun map(
            active: Boolean = true,
            vpn: Boolean = false,
            wifi: Boolean = false,
            cell: Boolean = false,
            eth: Boolean = false,
        ) = NetworkTypeMapper.from(active, vpn, wifi, cell, eth)
        assertEquals(NetworkType.None, map(active = false, wifi = true))
        assertEquals(NetworkType.Vpn, map(vpn = true, wifi = true))
        assertEquals(NetworkType.Wifi, map(wifi = true, cell = true))
        assertEquals(NetworkType.Cellular, map(cell = true))
        assertEquals(NetworkType.Ethernet, map(eth = true))
        assertEquals(NetworkType.Unknown, map())
    }
}
