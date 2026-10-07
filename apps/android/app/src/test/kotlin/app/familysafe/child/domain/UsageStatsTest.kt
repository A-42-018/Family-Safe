package app.familysafe.child.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class UsageStatsTest {
    private val minute = 60_000L
    private val dayEnd = 1440 * minute

    private fun at(kind: UsageEventKind, pkg: String?, minutes: Long) = UsageEvent(kind, pkg, minutes * minute)

    private fun fg(pkg: String, minutes: Long) = at(UsageEventKind.FOREGROUND, pkg, minutes)

    private fun bg(pkg: String, minutes: Long) = at(UsageEventKind.BACKGROUND, pkg, minutes)

    private fun on(minutes: Long) = at(UsageEventKind.SCREEN_ON, null, minutes)

    private fun off(minutes: Long) = at(UsageEventKind.SCREEN_OFF, null, minutes)

    private fun unlock(minutes: Long) = at(UsageEventKind.UNLOCK, null, minutes)

    private fun aggregate(events: List<UsageEvent>, end: Long = dayEnd) =
        UsageEventAggregator.aggregate(events, "2026-10-01", 0L, end)

    // ---- aggregator

    @Test
    fun `one app session counts its minutes and one launch`() {
        val usage = aggregate(listOf(fg("com.a.a", 10), bg("com.a.a", 40)))
        assertEquals(listOf(AppUsageEntry("com.a.a", 30, 1)), usage.apps)
        assertEquals(30, usage.totalScreenMinutes)
        assertEquals("2026-10-01", usage.day)
    }

    @Test
    fun `a second foreground event for an open app is not a new launch`() {
        val usage = aggregate(listOf(fg("com.a.a", 10), fg("com.a.a", 20), bg("com.a.a", 40)))
        assertEquals(listOf(AppUsageEntry("com.a.a", 30, 1)), usage.apps)
    }

    @Test
    fun `opening an app again after it left counts a second launch and adds the time`() {
        val usage = aggregate(listOf(fg("com.a.a", 0), bg("com.a.a", 10), fg("com.a.a", 50), bg("com.a.a", 60)))
        assertEquals(listOf(AppUsageEntry("com.a.a", 20, 2)), usage.apps)
    }

    @Test
    fun `an app that was already open when the day began is not counted for the earlier part`() {
        val usage = aggregate(listOf(bg("com.a.a", 5), fg("com.b.b", 10), bg("com.b.b", 20)))
        assertEquals(listOf(AppUsageEntry("com.b.b", 10, 1)), usage.apps)
    }

    @Test
    fun `an app still open at the end of the window counts up to the end`() {
        val usage = aggregate(listOf(fg("com.a.a", 1400)))
        assertEquals(listOf(AppUsageEntry("com.a.a", 40, 1)), usage.apps)
        val today = aggregate(listOf(fg("com.a.a", 660)), end = 720 * minute)
        assertEquals(listOf(AppUsageEntry("com.a.a", 60, 1)), today.apps)
    }

    @Test
    fun `screen off closes every open app at that moment`() {
        val usage = aggregate(listOf(on(0), fg("com.a.a", 10), off(30), fg("com.b.b", 40), bg("com.b.b", 45)))
        assertEquals(
            listOf(AppUsageEntry("com.a.a", 20, 1), AppUsageEntry("com.b.b", 5, 1)),
            usage.apps,
        )
        assertEquals(30, usage.totalScreenMinutes)
    }

    @Test
    fun `screen time is the time the screen was on, not the sum of app time`() {
        val usage = aggregate(listOf(on(10), fg("com.a.a", 10), bg("com.a.a", 20), off(70)))
        assertEquals(60, usage.totalScreenMinutes)
        assertEquals(10, usage.apps.single().foregroundMinutes)
    }

    @Test
    fun `a leading screen-off means the screen was on since the day began`() {
        val usage = aggregate(listOf(off(30), on(100)))
        assertEquals(30 + (1440 - 100), usage.totalScreenMinutes)
    }

    @Test
    fun `without any screen event the total falls back to the summed app time`() {
        val usage = aggregate(listOf(fg("com.a.a", 0), bg("com.a.a", 10), fg("com.b.b", 20), bg("com.b.b", 25)))
        assertEquals(15, usage.totalScreenMinutes)
    }

    @Test
    fun `an open screen at the end counts up to the end`() {
        assertEquals(1340, aggregate(listOf(on(100))).totalScreenMinutes)
    }

    @Test
    fun `the total never exceeds one day`() {
        assertEquals(1440, aggregate(listOf(on(0))).totalScreenMinutes)
        val longDay = UsageEventAggregator.aggregate(listOf(on(0)), "2026-10-25", 0L, 1500 * minute)
        assertEquals(UsageLimits.MAX_MINUTES, longDay.totalScreenMinutes)
    }

    @Test
    fun `unlocks are counted`() {
        assertEquals(3, aggregate(listOf(unlock(1), unlock(2), unlock(900))).unlockCount)
        assertEquals(0, aggregate(emptyList()).unlockCount)
    }

    @Test
    fun `events outside the window are ignored`() {
        val usage = aggregate(listOf(fg("com.a.a", -10), bg("com.a.a", 10), unlock(-1), unlock(1441)))
        assertTrue(usage.apps.isEmpty())
        assertEquals(0, usage.unlockCount)
    }

    @Test
    fun `input order does not matter`() {
        val ordered = listOf(fg("com.a.a", 10), bg("com.a.a", 40), unlock(5))
        assertEquals(aggregate(ordered), aggregate(ordered.reversed()))
    }

    @Test
    fun `minutes are rounded down`() {
        val usage = aggregate(
            listOf(
                UsageEvent(UsageEventKind.FOREGROUND, "com.a.a", 0L),
                UsageEvent(UsageEventKind.BACKGROUND, "com.a.a", 119_000L),
            ),
        )
        assertEquals(1, usage.apps.single().foregroundMinutes)
    }

    @Test
    fun `a foreground event without a package is ignored`() {
        val usage = aggregate(listOf(at(UsageEventKind.FOREGROUND, null, 5)))
        assertTrue(usage.apps.isEmpty())
    }

    @Test
    fun `apps come out sorted by package name`() {
        val usage = aggregate(listOf(fg("com.z.z", 0), bg("com.z.z", 5), fg("com.a.a", 6), bg("com.a.a", 9)))
        assertEquals(listOf("com.a.a", "com.z.z"), usage.apps.map { it.packageName })
    }

    // ---- day boundaries

    private val berlin = ZoneId.of("Europe/Berlin")

    private fun noon(date: String, zone: ZoneId): Long =
        LocalDate.parse(date).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()

    private fun hours(day: LocalDay): Long = (day.endMillis - day.startMillis) / 3_600_000L

    @Test
    fun `a normal day is 24 hours and the label is the local date`() {
        val day = UsageDays.dayOf(noon("2026-06-10", berlin), berlin)
        assertEquals("2026-06-10", day.day)
        assertEquals(24L, hours(day))
    }

    @Test
    fun `the day of a daylight-saving change is 23 or 25 hours long`() {
        assertEquals(23L, hours(UsageDays.dayOf(noon("2026-03-29", berlin), berlin)))
        assertEquals(25L, hours(UsageDays.dayOf(noon("2026-10-25", berlin), berlin)))
    }

    @Test
    fun `an open app on a 23-hour day is counted for 23 hours`() {
        val day = UsageDays.dayOf(noon("2026-03-29", berlin), berlin)
        val usage = UsageEventAggregator.aggregate(
            listOf(UsageEvent(UsageEventKind.FOREGROUND, "com.a.a", day.startMillis)),
            day.day,
            day.startMillis,
            day.endMillis,
        )
        assertEquals(23 * 60, usage.apps.single().foregroundMinutes)
    }

    @Test
    fun `just after local midnight belongs to the new local day even when UTC is still yesterday`() {
        val epoch = Instant.parse("2026-03-31T23:30:00Z").toEpochMilli()
        assertEquals("2026-04-01", UsageDays.dayOf(epoch, berlin).day)
        assertEquals("2026-03-31", UsageDays.dayOf(epoch, ZoneId.of("UTC")).day)
    }

    @Test
    fun `consecutive days touch without a gap or overlap`() {
        val today = UsageDays.dayOf(noon("2026-03-29", berlin), berlin)
        val yesterday = UsageDays.previous(today, berlin)
        assertEquals("2026-03-28", yesterday.day)
        assertEquals(today.startMillis, yesterday.endMillis)
    }

    @Test
    fun `previous steps across a month and year end`() {
        val utc = ZoneId.of("UTC")
        assertEquals("2025-12-31", UsageDays.previous(UsageDays.dayOf(noon("2026-01-01", utc), utc), utc).day)
        assertEquals("2026-02-28", UsageDays.previous(UsageDays.dayOf(noon("2026-03-01", utc), utc), utc).day)
    }

    // ---- sanitizer

    private fun app(pkg: String, minutes: Int, launches: Int = 1) = AppUsageEntry(pkg, minutes, launches)

    private fun day(apps: List<AppUsageEntry>, total: Int = 100, unlocks: Int = 5, omitted: Int = 0) =
        DayUsage("2026-10-01", total, unlocks, apps, omitted)

    @Test
    fun `a day that is not a real date is refused`() {
        for (bad in listOf("2026-02-30", "2026-13-01", "26-01-01", "2026-1-01", "", "2026-10-01T00:00")) {
            assertNull(UsageSanitizer.sanitize(DayUsage(bad, 1, 1, emptyList())), bad)
        }
        assertNotNull(UsageSanitizer.sanitize(DayUsage("2028-02-29", 1, 1, emptyList())))
    }

    @Test
    fun `invalid package names are dropped and counted`() {
        val result = UsageSanitizer.sanitize(day(listOf(app("com.a.a", 5), app("not a package", 5), app("x", 5))))!!
        assertEquals(listOf("com.a.a"), result.apps.map { it.packageName })
        assertEquals(2, result.omittedCount)
    }

    @Test
    fun `a package name over 255 characters is dropped`() {
        val long = "a." + "b".repeat(UsageLimits.PACKAGE_MAX)
        val result = UsageSanitizer.sanitize(day(listOf(app(long, 5))))!!
        assertTrue(result.apps.isEmpty())
        assertEquals(1, result.omittedCount)
    }

    @Test
    fun `a duplicate package keeps the larger values`() {
        val result = UsageSanitizer.sanitize(day(listOf(app("com.a.a", 5, 9), app("com.a.a", 8, 2))))!!
        assertEquals(listOf(app("com.a.a", 8, 9)), result.apps)
    }

    @Test
    fun `values are clamped into the contract range`() {
        val result = UsageSanitizer.sanitize(day(listOf(app("com.a.a", 5000, 99999)), total = 5000, unlocks = 99999))!!
        assertEquals(UsageLimits.MAX_MINUTES, result.totalScreenMinutes)
        assertEquals(UsageLimits.MAX_COUNT, result.unlockCount)
        assertEquals(app("com.a.a", UsageLimits.MAX_MINUTES, UsageLimits.MAX_COUNT), result.apps.single())
        val negative = UsageSanitizer.sanitize(day(listOf(app("com.a.a", -5, -1)), total = -3, unlocks = -1))!!
        assertEquals(0, negative.totalScreenMinutes)
        assertEquals(0, negative.unlockCount)
        assertTrue(negative.apps.isEmpty())
    }

    @Test
    fun `apps with no minutes and no launches are not shared`() {
        val result = UsageSanitizer.sanitize(day(listOf(app("com.a.a", 0, 0), app("com.b.b", 0, 2))))!!
        assertEquals(listOf("com.b.b"), result.apps.map { it.packageName })
        assertEquals(1, result.omittedCount)
    }

    @Test
    fun `more than 200 apps keeps the 200 busiest`() {
        val many = (1..250).map { app("com.example.app%03d".format(it), minutes = 1 + (it % 2), launches = it) }
        val result = UsageSanitizer.sanitize(day(many))!!
        assertEquals(UsageLimits.MAX_APPS, result.apps.size)
        assertEquals(50, result.omittedCount)
        assertTrue(result.apps.all { it.foregroundMinutes == 2 || it.launchCount >= 51 })
    }

    @Test
    fun `app minutes never add up to more than one day`() {
        val result = UsageSanitizer.sanitize(
            day(listOf(app("com.a.a", 800), app("com.b.b", 700), app("com.c.c", 600))),
        )!!
        assertEquals(listOf("com.a.a", "com.c.c"), result.apps.map { it.packageName })
        assertTrue(result.apps.sumOf { it.foregroundMinutes } <= UsageLimits.MAX_MINUTES)
        assertEquals(1, result.omittedCount)
    }

    @Test
    fun `earlier omissions are carried over`() {
        assertEquals(7, UsageSanitizer.sanitize(day(listOf(app("com.a.a", 1)), omitted = 7))!!.omittedCount)
    }

    @Test
    fun `sanitizing twice changes nothing`() {
        val once = UsageSanitizer.sanitize(
            day(listOf(app("com.b.b", 5), app("com.a.a", 50, 3), app("bad", 1), app("com.c.c", 0, 0))),
        )!!
        assertEquals(once, UsageSanitizer.sanitize(once))
    }

    @Test
    fun `ranking is minutes then launches then package name`() {
        val result = UsageSanitizer.sanitize(
            day(listOf(app("com.d.d", 5, 1), app("com.c.c", 5, 9), app("com.b.b", 5, 9), app("com.a.a", 50, 1))),
        )!!
        assertEquals(listOf("com.a.a", "com.b.b", "com.c.c", "com.d.d"), result.apps.map { it.packageName })
    }

    // ---- codec

    private val sample = UsageSanitizer.sanitize(
        day(listOf(app("com.a.a", 60, 3), app("com.b.b", 10, 1)), total = 125, unlocks = 7, omitted = 2),
    )!!

    @Test
    fun `a report survives encode and decode`() {
        val decoded = UsageReportCodec.decode(UsageReportCodec.encode(UsageReport(sample, 1_700_000_000_000L)))!!
        assertEquals(sample, decoded.usage)
        assertEquals(1_700_000_000_000L, decoded.sentAtEpochMillis)
    }

    @Test
    fun `an empty app list survives too`() {
        val empty = DayUsage("2026-10-01", 0, 0, emptyList())
        val decoded = UsageReportCodec.decode(UsageReportCodec.encode(UsageReport(empty, 5L)))!!
        assertEquals(empty, decoded.usage)
    }

    @Test
    fun `junk reads as nothing sent`() {
        val good = UsageReportCodec.encode(UsageReport(sample, 5L))
        val fieldSep = '\u001f'
        val cases = listOf(
            null,
            "",
            "yesterday",
            "v2" + good.removePrefix("v1"),
            good.replace("2026-10-01", "2026-02-30"),
            good.replace("${fieldSep}125$fieldSep", "${fieldSep}9999$fieldSep"),
            good.replace("com.a.a", "not a package"),
            good.replace("v1${fieldSep}5$fieldSep", "v1${fieldSep}0$fieldSep"),
            good + "\u001ecom.c.c${fieldSep}1",
            good.replace("com.a.a${fieldSep}60${fieldSep}3", "com.a.a${fieldSep}60${fieldSep}x"),
        )
        for (case in cases) assertNull(UsageReportCodec.decode(case), case.toString())
    }

    @Test
    fun `more than 200 stored apps is refused`() {
        val fieldSep = '\u001f'
        val header = listOf("v1", "5", "2026-10-01", "0", "0", "0").joinToString(fieldSep.toString())
        val rows = (1..201).map { "com.example.app%03d${fieldSep}1${fieldSep}1".format(it) }
        assertNull(UsageReportCodec.decode((listOf(header) + rows).joinToString("\u001e")))
    }

    @Test
    fun `stored data that sanitizing would change is refused`() {
        val fieldSep = '\u001f'
        val header = listOf("v1", "5", "2026-10-01", "10", "0", "0").joinToString(fieldSep.toString())
        // Not in ranking order: a genuine acknowledged report is always ranked.
        val text = listOf(
            header,
            "com.b.b${fieldSep}1${fieldSep}1",
            "com.a.a${fieldSep}50${fieldSep}1",
        ).joinToString("\u001e")
        assertNull(UsageReportCodec.decode(text))
    }

    // ---- policy

    private val grantedNow = 10 * 60 * minute

    @Test
    fun `no extra upload without usage access`() {
        for (access in listOf(UsageAccess.NOT_GRANTED, UsageAccess.UNKNOWN)) {
            assertFalse(UsagePolicy.needsUploadNow(access, null, grantedNow))
        }
    }

    @Test
    fun `with access an upload is due when nothing was acknowledged yet`() {
        assertTrue(UsagePolicy.needsUploadNow(UsageAccess.GRANTED, null, grantedNow))
    }

    @Test
    fun `a recent upload is not repeated, an old one is`() {
        val recent = UsageReport(sample, grantedNow - 29 * minute)
        val old = UsageReport(sample, grantedNow - 30 * minute)
        assertFalse(UsagePolicy.needsUploadNow(UsageAccess.GRANTED, recent, grantedNow))
        assertTrue(UsagePolicy.needsUploadNow(UsageAccess.GRANTED, old, grantedNow))
    }

    @Test
    fun `a clock that went backwards counts as due`() {
        val future = UsageReport(sample, grantedNow + minute)
        assertTrue(UsagePolicy.needsUploadNow(UsageAccess.GRANTED, future, grantedNow))
    }

    @Test
    fun `yesterday is sent again on the first upload of a new local day`() {
        assertTrue(UsagePolicy.includesYesterday(null, "2026-10-01"))
        assertTrue(UsagePolicy.includesYesterday(UsageReport(sample, 1L), "2026-10-02"))
        assertFalse(UsagePolicy.includesYesterday(UsageReport(sample, 1L), "2026-10-01"))
    }

    @Test
    fun `limits match the documented contract numbers`() {
        assertEquals(200, UsageLimits.MAX_APPS)
        assertEquals(1440, UsageLimits.MAX_MINUTES)
        assertEquals(10000, UsageLimits.MAX_COUNT)
        assertEquals(255, UsageLimits.PACKAGE_MAX)
        assertEquals(6L, UsageLimits.INTERVAL_HOURS)
    }

    // ---- display

    @Test
    fun `usage access shows as on or not turned on, never as denied`() {
        assertEquals(PermissionState.GRANTED, UsageDisplay.permissionState(UsageAccess.GRANTED))
        assertEquals(PermissionState.NOT_REQUESTED, UsageDisplay.permissionState(UsageAccess.NOT_GRANTED))
        assertEquals(PermissionState.NOT_REQUESTED, UsageDisplay.permissionState(UsageAccess.UNKNOWN))
    }

    @Test
    fun `only the usage access row is replaced by the live reading`() {
        val before = PermissionCatalog.initial()
        val after = UsageDisplay.withUsageAccess(before, UsageAccess.GRANTED)
        assertEquals(before.map { it.key }, after.map { it.key })
        for ((old, new) in before.zip(after)) {
            if (old.key == PermissionKey.USAGE_ACCESS) {
                assertEquals(PermissionState.GRANTED, new.state)
            } else {
                assertEquals(old.state, new.state)
            }
        }
    }

    @Test
    fun `top apps are the busiest, limited to five by default`() {
        val apps = (1..8).map { app("com.example.app$it", minutes = it * 10, launches = it) }
        val top = UsageDisplay.topApps(apps)
        assertEquals(UsageDisplay.TOP_APPS, top.size)
        assertEquals("com.example.app8", top.first().packageName)
        assertEquals(2, UsageDisplay.topApps(apps, limit = 2).size)
        assertTrue(UsageDisplay.topApps(emptyList()).isEmpty())
    }

    @Test
    fun `minutes split into hours and minutes`() {
        assertEquals(0 to 45, UsageDisplay.hoursAndMinutes(45))
        assertEquals(1 to 0, UsageDisplay.hoursAndMinutes(60))
        assertEquals(2 to 5, UsageDisplay.hoursAndMinutes(125))
        assertEquals(0 to 0, UsageDisplay.hoursAndMinutes(-5))
    }

    @Test
    fun `nothing printable leaks the numbers or package names`() {
        assertEquals("DayUsage", sample.toString())
        assertEquals("UsageReport", UsageReport(sample, 1L).toString())
        assertEquals("AppUsageEntry", app("com.a.a", 1).toString())
        assertEquals("UsageEvent", fg("com.a.a", 1).toString())
    }
}
