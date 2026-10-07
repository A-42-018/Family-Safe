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
        timezone: String? = null,
        schedules: List<ScheduleWindow> = emptyList(),
    ) = ScreenTimeConfig.validated(version, limit, overrides, emptyList(), timezone, schedules)

    private fun parse(
        version: Int = 3,
        limit: Int? = 120,
        overrides: Map<String, Int> = emptyMap(),
        timezone: String? = null,
        schedules: List<RawSchedule> = emptyList(),
        serverTime: String = "2026-10-01T09:30:00.000Z",
        interval: Int = 21_600,
    ) = ScreenTimeConfigParser.parse(
        version,
        limit,
        overrides,
        emptyList(),
        timezone,
        schedules,
        serverTime,
        interval,
    )

    private fun window(
        id: Int,
        type: String = "BEDTIME",
        days: List<Int> = listOf(
            1,
            2,
        ),
        start: String = "21:30",
        end: String = "07:00",
    ) = ScheduleWindow.validated("00000000-0000-4000-8000-%012d".format(id), "Night mode", type, days, start, end)!!

    private fun raw(
        id: Int,
        type: String = "BEDTIME",
        days: List<Int> = listOf(
            1,
            2,
        ),
        start: String = "21:30",
        end: String = "07:00",
    ) = RawSchedule("00000000-0000-4000-8000-%012d".format(id), "Night mode", type, days, start, end)

    private val nightWindow = window(1)

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
        for (zone in listOf("", "EST", "Mars", "posix/UTC", "SystemV/EST5", "utc", "Asia/Dhaka/A/B", "x".repeat(65))) {
            assertNull(config(timezone = zone), zone)
        }
        assertNull(config(schedules = listOf(window(1), window(2)))) // same type, same time: overlap
        assertNull(config(schedules = listOf(window(1), window(1, type = "SCHOOL")))) // duplicate id
        val edge = config(
            limit = 0,
            overrides = mapOf(1 to 0, 7 to 1_440),
            timezone = "Asia/Dhaka",
            schedules = listOf(nightWindow, window(2, type = "SCHOOL")),
        )
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
        assertFalse(config(schedules = listOf(nightWindow))!!.toString().contains("Night"))
        assertFalse(a == config(overrides = mapOf(1 to 10), timezone = "Asia/Dhaka"))
        assertFalse(a == config(overrides = mapOf(1 to 10), schedules = listOf(nightWindow)))
        assertEquals("CachedScreenTimeConfig(v3)", CachedScreenTimeConfig(a, 5L).toString())
    }

    // --- parser (wire values of deviceConfigSchema) ---

    @Test
    fun `a valid body parses, with the server time`() {
        val p = parse(
            overrides = mapOf("6" to 180),
            timezone = "Asia/Dhaka",
            schedules = listOf(raw(1), raw(2, type = "SCHOOL", days = listOf(1), start = "08:00", end = "15:00")),
        )!!
        assertEquals(3, p.config.version)
        assertEquals(120, p.config.dailyLimitMinutes)
        assertEquals(mapOf(6 to 180), p.config.dayOverrides)
        assertEquals("Asia/Dhaka", p.config.timezone)
        assertEquals(listOf(ScheduleType.BEDTIME, ScheduleType.SCHOOL), p.config.schedules.map { it.type })
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
    fun `schedules and the time zone are checked like the contract`() {
        assertNotNull(parse(timezone = null, schedules = emptyList()))
        assertNull(parse(timezone = "EST"))
        assertNull(parse(schedules = listOf(raw(1, start = "22:00", end = "22:00"))))
        assertNull(parse(schedules = listOf(raw(1, start = "24:00"))))
        assertNull(parse(schedules = listOf(raw(1, days = listOf(2, 1)))))
        assertNull(parse(schedules = listOf(raw(1, type = "NAP"))))
        assertNull(parse(schedules = listOf(raw(1), raw(2)))) // same type overlap
        assertNull(parse(schedules = listOf(raw(1), raw(1, type = "SCHOOL")))) // duplicate id
        assertNull(parse(schedules = (1..ScheduleLimits.MAX + 1).map { raw(it, type = "CUSTOM", days = listOf(1)) }))
        assertNotNull(parse(schedules = listOf(raw(1), raw(2, type = "SCHOOL"))))
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
            config(
                limit = 90,
                overrides = mapOf(6 to 180, 3 to 30),
                timezone = "Asia/Dhaka",
                schedules = listOf(nightWindow),
            ),
            config(
                limit = 90,
                schedules = listOf(
                    nightWindow,
                    window(2, type = "SCHOOL", days = listOf(3), start = "08:00", end = "15:00"),
                ),
            ),
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
                timezone = "Asia/Dhaka",
                schedules = listOf(nightWindow),
            )!!,
            42L,
        )
        assertEquals(
            "v3;42;4;90;3=30,6=180;Asia/Dhaka;00000000-0000-4000-8000-000000000001~BEDTIME~1,2~21:30~07:00~Night+mode;",
            ScreenTimeConfigCodec.encode(cached),
        )
        val bare = CachedScreenTimeConfig(config(version = 1, limit = null)!!, 42L)
        assertEquals("v3;42;1;;;;;", ScreenTimeConfigCodec.encode(bare))
    }

    @Test
    fun `codec rejects junk and anything validated would not allow`() {
        val id = "00000000-0000-4000-8000-000000000001"
        val junk = listOf(
            null, "", "yesterday", "v3;42;4;90;;;", "v3;0;4;90;;;;", "v3;-5;4;90;;;;", "v3;x;4;90;;;;",
            "v3;42;x;90;;;;", "v3;42;0;90;;;;", "v3;42;4;1441;;;;", "v3;42;4;x;;;;", "v3;42;4;90;9=10;;;",
            "v3;42;4;90;1=10,1=20;;;", "v3;42;4;90;1;;;", "v3;42;4;90;1=;;;", "v3;42;4;90;;;;;extra",
            // time zone field
            "v3;42;4;90;;EST;;", "v3;42;4;90;;Mars;;", "v3;42;4;90;;posix/UTC;;",
            // schedule field: bad shapes, bad values, duplicate id, same-type overlap
            "v3;42;4;90;;;bad;", "v3;42;4;90;;;$id~BEDTIME~1~21:30~07:00;", "v3;42;4;90;;;$id~NAP~1~21:30~07:00~n;",
            "v3;42;4;90;;;$id~BEDTIME~2,1~21:30~07:00~n;", "v3;42;4;90;;;$id~BEDTIME~1~22:00~22:00~n;",
            "v3;42;4;90;;;$id~BEDTIME~1~21:30~07:00~%ZZ;",
            "v3;42;4;90;;;$id~BEDTIME~1~21:30~07:00~a|$id~SCHOOL~1~08:00~09:00~b;",
            "v3;42;4;90;;;$id~BEDTIME~1~21:30~07:00~a|00000000-0000-4000-8000-000000000002~BEDTIME~1~22:00~23:00~b;",
            // app rules field: bad package, bad code, duplicate package, the child app itself
            "v3;42;4;90;;;;x=B", "v3;42;4;90;;;;com.a.b=X1", "v3;42;4;90;;;;com.a.b=L",
            "v3;42;4;90;;;;com.a.b=L1441",
            "v3;42;4;90;;;;com.a.b=B,com.a.b=L5", "v3;42;4;90;;;;app.familysafe.child=B",
            // the older forms read as no cache on purpose (full pull next time)
            "v2;42;4;90;;;0;", "v2;42;4;90;3=30,6=180;21:30-07:00;1;", "42;4;90;3=30,6=180;21:30-07:00;1", "42;1;;;;0",
        )
        for (text in junk) assertNull(ScreenTimeConfigCodec.decode(text), text.toString())
    }

    @Test
    fun `codec round-trips app rules in the v3 string`() {
        val rules = listOf(
            AppRule.validated("com.example.game", true, null)!!,
            AppRule.validated("com.example.video", false, 45)!!,
            AppRule.validated("com.example.chat", true, 60)!!,
        )
        val shape = ScreenTimeConfig.validated(7, 90, emptyMap(), rules)!!
        val text = ScreenTimeConfigCodec.encode(CachedScreenTimeConfig(shape, 42L))
        assertEquals("v3;42;7;90;;;;com.example.chat=B60,com.example.game=B,com.example.video=L45", text)
        val back = ScreenTimeConfigCodec.decode(text)!!
        assertEquals(shape, back.config)
        assertEquals(setOf("com.example.chat", "com.example.game"), back.config.blockedPackages)
    }

    @Test
    fun `a pre-18c six-field cache is no cache`() {
        assertNull(ScreenTimeConfigCodec.decode("1700000000000;4;90;3=30,6=180;21:30-07:00;1"))
    }

    @Test
    fun `a parent-typed name with separators survives the cache`() {
        val name = "A;B|C~D,E=F 100% \u00e9\u09ac"
        val w = ScheduleWindow.validated(
            "00000000-0000-4000-8000-000000000009",
            name,
            "CUSTOM",
            listOf(3),
            "10:00",
            "11:00",
        )!!
        val shape = config(schedules = listOf(w))!!
        val back = ScreenTimeConfigCodec.decode(ScreenTimeConfigCodec.encode(CachedScreenTimeConfig(shape, 9L)))!!
        assertEquals(name, back.config.schedules.single().name)
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
