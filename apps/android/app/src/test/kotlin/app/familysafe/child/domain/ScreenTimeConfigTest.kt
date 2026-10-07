package app.familysafe.child.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ScreenTimeConfigTest {
    private fun config(
        version: Int = 3,
        limit: Int? = 120,
        overrides: Map<Int, Int> = emptyMap(),
        bedtime: BedtimeWindow? = null,
        school: Boolean = false,
    ) = ScreenTimeConfig.validated(version, limit, overrides, bedtime, school)

    private fun parse(
        version: Int = 3,
        limit: Int? = 120,
        overrides: Map<String, Int> = emptyMap(),
        bedtimeEnabled: Boolean = false,
        start: String? = null,
        end: String? = null,
        school: Boolean = false,
        serverTime: String = "2026-10-01T09:30:00.000Z",
        interval: Int = 21_600,
    ) = ScreenTimeConfigParser.parse(
        version, limit, overrides, bedtimeEnabled, start, end, school, emptyList(), serverTime, interval,
    )

    private val nightWindow = BedtimeWindow("21:30", "07:00")

    // --- effective limit: same table as effectiveDailyLimitMinutes in the contracts ---

    @Test
    fun `an override beats the default, absent override uses the default`() {
        val c = config(limit = 120, overrides = mapOf(6 to 180, 7 to 180))!!
        assertEquals(120, c.limitFor(1))
        assertEquals(180, c.limitFor(6))
        assertEquals(180, c.limitFor(7))
    }

    @Test
    fun `an override of zero means no screen time, not no limit`() {
        val c = config(limit = 120, overrides = mapOf(3 to 0))!!
        assertEquals(0, c.limitFor(3))
        assertEquals(120, c.limitFor(4))
    }

    @Test
    fun `no default and no override is no limit, an override still applies`() {
        val c = config(limit = null, overrides = mapOf(2 to 45))!!
        assertNull(c.limitFor(1))
        assertEquals(45, c.limitFor(2))
        assertFalse(config(limit = null)!!.hasAnyLimit)
        assertTrue(c.hasAnyLimit)
        assertTrue(config(limit = 0)!!.hasAnyLimit)
    }

    @Test
    fun `etag is the quoted version the server uses`() {
        assertEquals("\"v3\"", config(version = 3)!!.etag())
        assertEquals("\"v999999999\"", config(version = 999_999_999)!!.etag())
    }

    @Test
    fun `validated rejects every out-of-contract value`() {
        assertNull(config(version = 0))
        assertNull(config(version = 1_000_000_000))
        assertNull(config(limit = -1))
        assertNull(config(limit = 1_441))
        assertNull(config(overrides = mapOf(0 to 10)))
        assertNull(config(overrides = mapOf(8 to 10)))
        assertNull(config(overrides = mapOf(1 to 1_441)))
        assertNull(config(overrides = mapOf(1 to -5)))
        assertNull(config(bedtime = BedtimeWindow("22:00", "22:00")))
        assertNull(config(bedtime = BedtimeWindow("24:00", "07:00")))
        assertNull(config(bedtime = BedtimeWindow("9:00", "07:00")))
        assertNull(config(bedtime = BedtimeWindow("21:60", "07:00")))
        val edge = config(limit = 0, overrides = mapOf(1 to 0, 7 to 1_440), bedtime = BedtimeWindow("21:30", "07:00"))
        assertNotNull(edge)
        assertNotNull(config(limit = 1_440, version = 1))
    }

    @Test
    fun `equality and toString never leak the rule values`() {
        val a = config(overrides = mapOf(1 to 10))!!
        val b = config(overrides = mapOf(1 to 10))!!
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
        assertFalse(a == config(overrides = mapOf(1 to 11)))
        assertEquals("ScreenTimeConfig(v3)", a.toString())
        assertEquals("BedtimeWindow", BedtimeWindow("21:00", "07:00").toString())
        assertEquals("CachedScreenTimeConfig(v3)", CachedScreenTimeConfig(a, 5L).toString())
    }

    // --- parser (wire values of deviceConfigSchema) ---

    @Test
    fun `a valid body parses, with the server time`() {
        val p = parse(
            overrides = mapOf("6" to 180),
            bedtimeEnabled = true,
            start = "21:00",
            end = "07:00",
            school = true,
        )!!
        assertEquals(3, p.config.version)
        assertEquals(120, p.config.dailyLimitMinutes)
        assertEquals(mapOf(6 to 180), p.config.dayOverrides)
        assertEquals(BedtimeWindow("21:00", "07:00"), p.config.bedtime)
        assertTrue(p.config.schoolModeEnabled)
        assertEquals(1_790_847_000_000L, p.serverTimeEpochMillis)
    }

    @Test
    fun `override keys must be exactly 1 to 7`() {
        for (key in listOf("0", "8", "01", "1 ", "", "mon", "-1", "10")) {
            assertNull(parse(overrides = mapOf(key to 10)), key)
        }
        for (key in 1..7) assertNotNull(parse(overrides = mapOf(key.toString() to 10)), key.toString())
    }

    @Test
    fun `bedtime times must match the switch`() {
        assertNull(parse(bedtimeEnabled = true, start = null, end = null))
        assertNull(parse(bedtimeEnabled = true, start = "21:00", end = null))
        assertNull(parse(bedtimeEnabled = true, start = "21:00", end = "21:00"))
        assertNull(parse(bedtimeEnabled = false, start = "21:00", end = "07:00"))
        assertNull(parse(bedtimeEnabled = false, start = "21:00", end = null))
        assertNotNull(parse(bedtimeEnabled = false))
    }

    @Test
    fun `the interval hint must be the contract value and the server time a real instant`() {
        assertNull(parse(interval = 3_600))
        assertNull(parse(interval = 0))
        assertNull(parse(serverTime = "yesterday"))
        assertNull(parse(serverTime = ""))
        assertNull(parse(serverTime = "2026-10-01"))
    }

    // --- freshness / expiry ---

    private val hour = 3_600_000L
    private val day = 24 * hour

    @Test
    fun `fresh until three intervals, stale until seven days, then expired (boundaries inclusive)`() {
        val t0 = 1_000_000_000_000L
        assertEquals(ConfigFreshness.FRESH, ConfigFreshness.of(t0, t0))
        assertEquals(ConfigFreshness.FRESH, ConfigFreshness.of(t0, t0 + 18 * hour))
        assertEquals(ConfigFreshness.STALE, ConfigFreshness.of(t0, t0 + 18 * hour + 1))
        assertEquals(ConfigFreshness.STALE, ConfigFreshness.of(t0, t0 + 7 * day))
        assertEquals(ConfigFreshness.EXPIRED, ConfigFreshness.of(t0, t0 + 7 * day + 1))
    }

    @Test
    fun `a confirmation in the future (clock moved back) counts as just now`() {
        assertEquals(ConfigFreshness.FRESH, ConfigFreshness.of(5_000L, 1_000L))
    }

    @Test
    fun `an expired config is not active, a stale one still is`() {
        val cached = CachedScreenTimeConfig(config()!!, 0L)
        assertNotNull(cached.activeConfig(18 * hour))
        assertNotNull(cached.activeConfig(7 * day))
        assertNull(cached.activeConfig(7 * day + 1))
    }

    @Test
    fun `limits are the values the contract and the plan name`() {
        assertEquals(21_600L, ScreenTimeLimits.INTERVAL_SECONDS)
        assertEquals(ScreenTimeLimits.INTERVAL_SECONDS, ScreenTimeLimits.INTERVAL_HOURS * 3_600)
        assertEquals(1_440, ScreenTimeLimits.MAX_MINUTES)
        assertEquals(18 * hour, ScreenTimeLimits.STALE_MILLIS)
        assertEquals(7 * day, ScreenTimeLimits.EXPIRY_MILLIS)
    }

    // --- codec ---

    @Test
    fun `codec round-trips every shape`() {
        val shapes = listOf(
            config(limit = null),
            config(limit = 0, overrides = mapOf(1 to 0, 7 to 1_440)),
            config(limit = 90, overrides = mapOf(6 to 180, 3 to 30), bedtime = nightWindow, school = true),
        )
        for (shape in shapes) {
            val cached = CachedScreenTimeConfig(shape!!, 1_700_000_000_000L)
            val back = ScreenTimeConfigCodec.decode(ScreenTimeConfigCodec.encode(cached))!!
            assertEquals(shape, back.config)
            assertEquals(1_700_000_000_000L, back.validatedAtEpochMillis)
        }
    }

    @Test
    fun `codec writes the documented single string`() {
        val cached = CachedScreenTimeConfig(
            config(
                version = 4,
                limit = 90,
                overrides = mapOf(6 to 180, 3 to 30),
                bedtime = nightWindow,
                school = true,
            )!!,
            42L,
        )
        assertEquals("v2;42;4;90;3=30,6=180;21:30-07:00;1;", ScreenTimeConfigCodec.encode(cached))
        val bare = CachedScreenTimeConfig(config(version = 1, limit = null)!!, 42L)
        assertEquals("v2;42;1;;;;0;", ScreenTimeConfigCodec.encode(bare))
    }

    @Test
    fun `codec rejects junk and anything validated would not allow`() {
        val junk = listOf(
            null, "", "yesterday", "v2;42;4;90;;;", "v2;0;4;90;;;0;", "v2;-5;4;90;;;0;", "v2;x;4;90;;;0;",
            "v2;42;x;90;;;0;", "v2;42;0;90;;;0;", "v2;42;4;1441;;;0;", "v2;42;4;x;;;0;", "v2;42;4;90;9=10;;0;",
            "v2;42;4;90;1=10,1=20;;0;", "v2;42;4;90;1;;0;", "v2;42;4;90;1=;;0;", "v2;42;4;90;;22:00-22:00;0;",
            "v2;42;4;90;;21:00;0;", "v2;42;4;90;;21:00-07:00-08:00;0;", "v2;42;4;90;;;2;", "v2;42;4;90;;;true;",
            "v2;42;4;90;;;0;;extra",
            // app rules field: bad package, bad code, duplicate package, the child app itself, no restriction at all
            "v2;42;4;90;;;0;x=B", "v2;42;4;90;;;0;com.a.b=X1", "v2;42;4;90;;;0;com.a.b=L",
            "v2;42;4;90;;;0;com.a.b=L1441",
            "v2;42;4;90;;;0;com.a.b=B,com.a.b=L5", "v2;42;4;90;;;0;app.familysafe.child=B",
            // the pre-18c six-field form reads as no cache on purpose (full pull next time)
            "42;4;90;3=30,6=180;21:30-07:00;1", "42;1;;;;0",
        )
        for (text in junk) assertNull(ScreenTimeConfigCodec.decode(text), text.toString())
    }

    @Test
    fun `codec round-trips app rules in the v2 string`() {
        val rules = listOf(
            AppRule.validated("com.example.game", true, null)!!,
            AppRule.validated("com.example.video", false, 45)!!,
            AppRule.validated("com.example.chat", true, 60)!!,
        )
        val shape = ScreenTimeConfig.validated(7, 90, emptyMap(), null, false, rules)!!
        val text = ScreenTimeConfigCodec.encode(CachedScreenTimeConfig(shape, 42L))
        assertEquals("v2;42;7;90;;;0;com.example.chat=B60,com.example.game=B,com.example.video=L45", text)
        val back = ScreenTimeConfigCodec.decode(text)!!
        assertEquals(shape, back.config)
        assertEquals(setOf("com.example.chat", "com.example.game"), back.config.blockedPackages)
    }

    @Test
    fun `a pre-18c six-field cache is no cache`() {
        assertNull(ScreenTimeConfigCodec.decode("1700000000000;4;90;3=30,6=180;21:30-07:00;1"))
    }

    // --- policy ---

    @Test
    fun `opening the app pulls only when a cache exists and was confirmed 30 minutes ago or more`() {
        val cached = CachedScreenTimeConfig(config()!!, 1_000_000L)
        val min = 60_000L
        assertFalse(ScreenTimeConfigPolicy.needsPullNow(null, 9_999_999_999L))
        assertFalse(ScreenTimeConfigPolicy.needsPullNow(cached, 1_000_000L + 30 * min - 1))
        assertTrue(ScreenTimeConfigPolicy.needsPullNow(cached, 1_000_000L + 30 * min))
        assertFalse(ScreenTimeConfigPolicy.needsPullNow(cached, 500L)) // clock moved back
    }
}
